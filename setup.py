import subprocess
import sys

def install(package):
    subprocess.check_call([sys.executable, "-m", "pip", "install", package])

# Install core dependencies
dependencies = [
    "flask",
    "flask-socketio",
    "python-socketio",
    "python-engineio",
    "uuid"  # Usually built-in, but just in case
]

print("Installing dependencies...")
for dep in dependencies:
    try:
        install(dep)
        print(f"✓ Installed {dep}")
    except Exception as e:
        print(f"✗ Failed to install {dep}: {e}")

print("\nInstallation complete! Run: python app.py")