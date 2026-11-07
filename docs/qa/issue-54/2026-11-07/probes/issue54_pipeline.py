import argparse
import http.server
import json
import os
from pathlib import Path
import subprocess
import threading
import time
import urllib.parse
import urllib.request
from issue54_probe import free_port, http as get_json


def main():
    parser = argparse.ArgumentParser()
    for key in ["engine", "models", "client", "output"]:
        parser.add_argument("--" + key, required=True)
    args = parser.parse_args()
    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)
    base = "http://127.0.0.1:" + str(free_port())
    jobs = {}
    attempts = []

    class Proxy(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            if self.path == "/logs":
                self.send_error(404, "probe uses elapsed-time progress")
            else:
                self.forward()

        def do_POST(self):
            self.forward()

        def forward(self):
            data = None
            tag = None
            if self.command == "POST":
                data = self.rfile.read(int(self.headers.get("Content-Length", "0")))
                if self.path in ["/lm", "/synth"]:
                    request = json.loads(data)
                    tag = "lm-" + str(len(attempts) + 1) if self.path == "/lm" else "synth"
                    (out / (tag + "-original.json")).write_text(json.dumps(request, ensure_ascii=False, indent=2) + "\n")
                    if self.path == "/lm":
                        if not attempts:
                            assert "lm_seed" not in request
                            request["lm_seed"] = 6
                        attempts.append(request)
                    (out / (tag + "-request.json")).write_text(json.dumps(request, ensure_ascii=False, indent=2) + "\n")
                    data = json.dumps(request).encode()
            request = urllib.request.Request(base + self.path, data=data, headers={"Content-Type": "application/json"}, method=self.command)
            with urllib.request.urlopen(request, timeout=180) as response:
                body = response.read()
                content_type = response.headers.get("Content-Type", "application/json")
                if tag:
                    jobs[str(json.loads(body)["id"])] = tag
                query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                if "result" in query:
                    result_tag = jobs.get(query["id"][0])
                    if result_tag and result_tag.startswith("lm-"):
                        (out / (result_tag + "-response.json")).write_bytes(body)
                self.send_response(response.status)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

    with (out / "engine.log").open("w") as log:
        process = subprocess.Popen([args.engine, "--models", args.models, "--host", "127.0.0.1", "--port", base.rsplit(":", 1)[1], "--max-batch", "1", "--keep-loaded"], cwd=Path(args.engine).parent, stdout=log, stderr=log)
        proxy = None
        try:
            for _ in range(120):
                if process.poll() is not None:
                    raise RuntimeError("engine exited " + str(process.returncode))
                try:
                    get_json(base + "/health")
                    break
                except Exception:
                    time.sleep(0.5)
            else:
                raise TimeoutError("engine startup")
            proxy = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Proxy)
            threading.Thread(target=proxy.serve_forever, daemon=True).start()
            url = "http://127.0.0.1:" + str(proxy.server_port)
            env = dict(os.environ, ISSUE54_ENGINE=url, ISSUE54_LM_PROXY=url, ISSUE54_OUTPUT=str(out))
            result = subprocess.run([args.client], env=env, capture_output=True, text=True, timeout=600)
            (out / "client.log").write_text(result.stdout + result.stderr)
            print(result.stdout + result.stderr, flush=True)
            assert result.returncode == 0, result.returncode
            assert len(attempts) == 2, len(attempts)
            assert attempts[0]["lm_seed"] == 6
            assert attempts[1]["lm_seed"] == 7
            assert all(x["vocal_language"] == "English" and x["lm_temperature"] == 0.85 for x in attempts)
            print("Captured two real LM attempts, seed 6 -> 7, English at 0.85", flush=True)
        finally:
            if proxy:
                proxy.shutdown()
                proxy.server_close()
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


if __name__ == "__main__":
    main()
