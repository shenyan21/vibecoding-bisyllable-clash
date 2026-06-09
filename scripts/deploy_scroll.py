import os, paramiko, glob

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("39.105.218.65", username="Administrator", password=os.environ["SSH_PASSWORD"], timeout=15)
sftp = ssh.open_sftp()

base = "C:/hextech-bisyllable-duel"

def ensure_dir(p):
    d = "/".join(p.split("/")[:-1])
    parts = d.split("/")
    for i in range(1, len(parts)+1):
        sub = "/".join(parts[:i])
        try: sftp.stat(sub)
        except:
            try: sftp.mkdir(sub)
            except: pass

# Stop the server first so files are not locked
print("Stopping server...")
_, o, _ = ssh.exec_command("schtasks /End /TN hextech-bisyllable-duel")
o.channel.recv_exit_status()
import time
time.sleep(2)

# Also kill any lingering node processes
print("Killing lingering node processes...")
ssh.exec_command("taskkill /F /IM node.exe 2>nul")
time.sleep(2)

# Upload
count = 0
for folder in ["dist", "server", "src"]:
    for f in glob.glob(folder + "/**/*", recursive=True):
        if os.path.isfile(f):
            rp = base + "/" + f.replace("\\", "/")
            ensure_dir(rp)
            try:
                sftp.put(f, rp)
                count += 1
                print(f"  {rp}")
            except Exception as e:
                print(f"  FAIL {rp}: {e}")

print(f"\nUploaded {count} files")

# Restart
print("Starting server...")
_, o, _ = ssh.exec_command("schtasks /Run /TN hextech-bisyllable-duel")
print(f"  exit={o.channel.recv_exit_status()}")

ssh.close()
print("Deploy done!")
