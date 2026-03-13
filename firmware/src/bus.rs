use std::io;
use tokio::sync::{mpsc, oneshot};

/// Errors from I2C bus operations.
#[derive(Debug)]
pub enum I2cError {
    Io(io::Error),
    ChannelClosed,
}

impl std::fmt::Display for I2cError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            I2cError::Io(e) => write!(f, "I2C IO error: {e}"),
            I2cError::ChannelClosed => write!(f, "I2C bus channel closed"),
        }
    }
}

impl std::error::Error for I2cError {}

impl From<io::Error> for I2cError {
    fn from(e: io::Error) -> Self {
        I2cError::Io(e)
    }
}

/// A request to the I2C bus owner task.
pub enum I2cRequest {
    WriteByteData {
        addr: u16,
        reg: u8,
        value: u8,
        reply: oneshot::Sender<Result<(), I2cError>>,
    },
    WriteWordData {
        addr: u16,
        reg: u8,
        value: u16,
        reply: oneshot::Sender<Result<(), I2cError>>,
    },
    ReadBlock {
        addr: u16,
        reg: u8,
        len: usize,
        reply: oneshot::Sender<Result<Vec<u8>, I2cError>>,
    },
    ReadWordData {
        addr: u16,
        reg: u8,
        reply: oneshot::Sender<Result<u16, I2cError>>,
    },
}

/// Cloneable handle to the I2C bus. All sensor drivers use this.
#[derive(Clone)]
pub struct I2cBus {
    tx: mpsc::Sender<I2cRequest>,
}

impl I2cBus {
    pub fn new(tx: mpsc::Sender<I2cRequest>) -> Self {
        Self { tx }
    }

    pub async fn write_byte_data(&self, addr: u16, reg: u8, value: u8) -> Result<(), I2cError> {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.tx
            .send(I2cRequest::WriteByteData {
                addr,
                reg,
                value,
                reply: reply_tx,
            })
            .await
            .map_err(|_| I2cError::ChannelClosed)?;
        reply_rx.await.map_err(|_| I2cError::ChannelClosed)?
    }

    pub async fn write_word_data(&self, addr: u16, reg: u8, value: u16) -> Result<(), I2cError> {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.tx
            .send(I2cRequest::WriteWordData {
                addr,
                reg,
                value,
                reply: reply_tx,
            })
            .await
            .map_err(|_| I2cError::ChannelClosed)?;
        reply_rx.await.map_err(|_| I2cError::ChannelClosed)?
    }

    pub async fn read_block(&self, addr: u16, reg: u8, len: usize) -> Result<Vec<u8>, I2cError> {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.tx
            .send(I2cRequest::ReadBlock {
                addr,
                reg,
                len,
                reply: reply_tx,
            })
            .await
            .map_err(|_| I2cError::ChannelClosed)?;
        reply_rx.await.map_err(|_| I2cError::ChannelClosed)?
    }

    pub async fn read_word_data(&self, addr: u16, reg: u8) -> Result<u16, I2cError> {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.tx
            .send(I2cRequest::ReadWordData {
                addr,
                reg,
                reply: reply_tx,
            })
            .await
            .map_err(|_| I2cError::ChannelClosed)?;
        reply_rx.await.map_err(|_| I2cError::ChannelClosed)?
    }
}

// ============================================================
// Real I2C bus owner (Linux only, requires "hw" feature)
// ============================================================
#[cfg(feature = "hw")]
pub fn run_bus_owner(path: &str, rx: &mut mpsc::Receiver<I2cRequest>) {
    use std::fs::OpenOptions;
    use std::os::unix::io::AsRawFd;

    let file = match OpenOptions::new().read(true).write(true).open(path) {
        Ok(f) => f,
        Err(e) => {
            tracing::error!("Failed to open {path}: {e}");
            return;
        }
    };
    let fd = file.as_raw_fd();

    tracing::info!("I2C bus owner started on {path}");

    while let Some(request) = rx.blocking_recv() {
        match request {
            I2cRequest::WriteByteData {
                addr,
                reg,
                value,
                reply,
            } => {
                let result = set_addr(fd, addr).and_then(|_| smbus_write_byte_data(fd, reg, value));
                let _ = reply.send(result);
            }
            I2cRequest::WriteWordData {
                addr,
                reg,
                value,
                reply,
            } => {
                let result = set_addr(fd, addr).and_then(|_| smbus_write_word_data(fd, reg, value));
                let _ = reply.send(result);
            }
            I2cRequest::ReadBlock {
                addr,
                reg,
                len,
                reply,
            } => {
                let result = set_addr(fd, addr).and_then(|_| i2c_read_block(fd, reg, len));
                let _ = reply.send(result);
            }
            I2cRequest::ReadWordData { addr, reg, reply } => {
                let result = set_addr(fd, addr).and_then(|_| smbus_read_word_data(fd, reg));
                let _ = reply.send(result);
            }
        }
    }

    tracing::info!("I2C bus owner shutting down");
}

#[cfg(feature = "hw")]
const I2C_SLAVE: u64 = 0x0703;
#[cfg(feature = "hw")]
const I2C_SMBUS: u64 = 0x0720;
#[cfg(feature = "hw")]
const I2C_SMBUS_READ: u8 = 1;
#[cfg(feature = "hw")]
const I2C_SMBUS_WRITE: u8 = 0;
#[cfg(feature = "hw")]
const I2C_SMBUS_BYTE_DATA: u32 = 2;
#[cfg(feature = "hw")]
const I2C_SMBUS_WORD_DATA: u32 = 3;
#[cfg(feature = "hw")]
const I2C_SMBUS_I2C_BLOCK_DATA: u32 = 8;

#[cfg(feature = "hw")]
#[repr(C)]
union SmbusData {
    byte: u8,
    word: u16,
    block: [u8; 34],
}

#[cfg(feature = "hw")]
#[repr(C)]
struct SmbusIoctlData {
    read_write: u8,
    command: u8,
    size: u32,
    data: *mut SmbusData,
}

#[cfg(feature = "hw")]
fn set_addr(fd: i32, addr: u16) -> Result<(), I2cError> {
    let ret = unsafe { libc::ioctl(fd, I2C_SLAVE, addr as libc::c_ulong) };
    if ret < 0 {
        Err(io::Error::last_os_error().into())
    } else {
        Ok(())
    }
}

#[cfg(feature = "hw")]
fn smbus_write_byte_data(fd: i32, reg: u8, value: u8) -> Result<(), I2cError> {
    let mut data = SmbusData { byte: value };
    let args = SmbusIoctlData {
        read_write: I2C_SMBUS_WRITE,
        command: reg,
        size: I2C_SMBUS_BYTE_DATA,
        data: &mut data,
    };
    let ret = unsafe { libc::ioctl(fd, I2C_SMBUS, &args as *const SmbusIoctlData) };
    if ret < 0 {
        Err(io::Error::last_os_error().into())
    } else {
        Ok(())
    }
}

#[cfg(feature = "hw")]
fn smbus_write_word_data(fd: i32, reg: u8, value: u16) -> Result<(), I2cError> {
    let swapped = value.swap_bytes();
    let mut data = SmbusData { word: swapped };
    let args = SmbusIoctlData {
        read_write: I2C_SMBUS_WRITE,
        command: reg,
        size: I2C_SMBUS_WORD_DATA,
        data: &mut data,
    };
    let ret = unsafe { libc::ioctl(fd, I2C_SMBUS, &args as *const SmbusIoctlData) };
    if ret < 0 {
        Err(io::Error::last_os_error().into())
    } else {
        Ok(())
    }
}

#[cfg(feature = "hw")]
fn smbus_read_word_data(fd: i32, reg: u8) -> Result<u16, I2cError> {
    let mut data = SmbusData { word: 0 };
    let args = SmbusIoctlData {
        read_write: I2C_SMBUS_READ,
        command: reg,
        size: I2C_SMBUS_WORD_DATA,
        data: &mut data,
    };
    let ret = unsafe { libc::ioctl(fd, I2C_SMBUS, &args as *const SmbusIoctlData) };
    if ret < 0 {
        Err(io::Error::last_os_error().into())
    } else {
        Ok(unsafe { data.word }.swap_bytes())
    }
}

#[cfg(feature = "hw")]
fn i2c_read_block(fd: i32, reg: u8, len: usize) -> Result<Vec<u8>, I2cError> {
    let mut data = SmbusData {
        block: [0u8; 34],
    };
    unsafe { data.block[0] = len as u8 };
    let args = SmbusIoctlData {
        read_write: I2C_SMBUS_READ,
        command: reg,
        size: I2C_SMBUS_I2C_BLOCK_DATA,
        data: &mut data,
    };
    let ret = unsafe { libc::ioctl(fd, I2C_SMBUS, &args as *const SmbusIoctlData) };
    if ret < 0 {
        Err(io::Error::last_os_error().into())
    } else {
        let block = unsafe { data.block };
        let actual_len = (block[0] as usize).min(len).min(32);
        Ok(block[1..1 + actual_len].to_vec())
    }
}
