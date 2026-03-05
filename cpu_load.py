import multiprocessing
import os

def burn():
    x = 1.0
    while True:
        x = (x * 1.0000001 + 0.1) % 1e10

if __name__ == "__main__":
    ncpus = multiprocessing.cpu_count()
    print(f"Burning {ncpus} cores (PID {os.getpid()}). Ctrl+C to stop.")
    procs = []
    for _ in range(ncpus):
        p = multiprocessing.Process(target=burn, daemon=True)
        p.start()
        procs.append(p)
    try:
        for p in procs:
            p.join()
    except KeyboardInterrupt:
        print("\nStopped.")
