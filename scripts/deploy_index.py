import paramiko, time, base64, sys

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("39.105.218.65", username="Administrator", password="Aqcsldsxpdl130", timeout=15)

# Read local index.html
with open("dist/index.html", "rb") as f:
    content = f.read()

b64 = base64.b64encode(content).decode()

# Write via SSH command (powershell)
cmd = f'powershell -Command "[System.Convert]::FromBase64String(\\"{b64}\\") | Set-Content -Path C:\\hextech-bisyllable-duel\\dist\\index.html -Encoding Byte"'
print(f"Writing {len(content)} bytes via SSH...")
_, o, e = ssh.exec_command(cmd)
exit_code = o.channel.recv_exit_status()
sys.stdout.buffer.write(f"Exit: {exit_code}\n".encode())

# Start server
_, o, _ = ssh.exec_command("schtasks /Run /TN hextech-bisyllable-duel")
sys.stdout.buffer.write(f"Start exit={o.channel.recv_exit_status()}\n".encode())

time.sleep(3)
_, o, _ = ssh.exec_command("curl -s http://localhost:3000/api/public-config")
out = o.read().decode("utf-8", errors="replace")[:200]
sys.stdout.buffer.write(f"API: {out}\n".encode())

ssh.close()
sys.stdout.buffer.write(b"Done!\n")
