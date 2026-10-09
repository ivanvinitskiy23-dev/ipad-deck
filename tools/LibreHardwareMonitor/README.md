# LibreHardwareMonitor (optional)

Hub **does not** auto-start LHM (window spam).

If you manually run LibreHardwareMonitor with **Options → Remote web server → Run**
on port `8085`, the hub will read `http://127.0.0.1:8085/data.json` for CPU°.

Otherwise vitals fall back to NVIDIA / psutil (GPU° · RAM · CPU%).

Release: https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases
