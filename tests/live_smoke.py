import argparse
import base64
import json
import os
import shlex
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "reference/python"))
import herdr_links as h


def main():
    parser = argparse.ArgumentParser(description="Opt-in live navigation test; briefly changes focus, creates only owned shells")
    parser.add_argument("--run", action="store_true", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    socket_path = h.socket_from_environment(os.environ)
    binary = Path(shutil.which("herdr"))
    baseline = h.get_snapshot(socket_path)
    self_pane = os.environ["HERDR_PANE_ID"]
    h.validate_live_target(baseline, "agent", self_pane)
    original_pane = baseline["focused_pane_id"]
    receipt = {
        "started": datetime.now(timezone.utc).isoformat(),
        "version": baseline["version"],
        "protocol": baseline["protocol"],
        "original_focus": original_pane,
        "agent_target": self_pane,
        "created_workspace": None,
        "created_panes": [],
        "created_tabs": [],
        "checks": [],
        "physical_ctrl_click": "not performed; action invocation is not a mouse event",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)

    def save():
        args.output.write_text(json.dumps(receipt, indent=2) + "\n")

    def cli(*arguments):
        return json.loads(h.run_cli(binary, list(arguments)))["result"]

    def plain_cli(*arguments):
        return h.run_cli(binary, list(arguments))

    def snapshot():
        return h.get_snapshot(socket_path)

    def focus(target):
        return h.api_request(socket_path, "pane.focus", {"pane_id": target}, "pane_info")

    def plugin_action(url, origin):
        context = {
            "invocation_source": "link_click",
            "clicked_url": url,
            "link_handler_id": h.LINK_HANDLER_ID,
            "workspace_id": origin["workspace_id"],
            "tab_id": origin["tab_id"],
            "focused_pane_id": origin["pane_id"],
        }
        response = h.api_request(
            socket_path, "plugin.action.invoke",
            {"plugin_id": h.PLUGIN_ID, "action_id": h.ACTION_ID, "context": context},
            "plugin_action_invoked",
        )
        log_id = response["log"]["log_id"]
        for _ in range(50):
            logs = h.api_request(
                socket_path, "plugin.log.list", {"plugin_id": h.PLUGIN_ID, "limit": 100}, "plugin_log_list"
            )["logs"]
            log = next(item for item in logs if item["log_id"] == log_id)
            if log["status"] != "running":
                return log
            time.sleep(0.1)
        raise AssertionError(f"plugin action did not complete: {log_id}")

    save()
    label = "herdr-links owned smoke " + str(time.time_ns())
    owned_workspace = None
    try:
        result = cli("workspace", "create", "--cwd", str(h.ROOT), "--label", label, "--no-focus")
        owned_workspace = result["workspace"]["workspace_id"]
        receipt["created_workspace"] = owned_workspace
        save()
        state = snapshot()
        origin = next(p for p in state["panes"] if p["workspace_id"] == owned_workspace)
        receipt["created_panes"].append(origin["pane_id"])
        receipt["created_tabs"].append(origin["tab_id"])
        save()
        tab = cli("tab", "create", "--workspace", owned_workspace, "--cwd", str(h.ROOT), "--no-focus")["tab"]
        receipt["created_tabs"].append(tab["tab_id"])
        state = snapshot()
        first_split = next(p for p in state["panes"] if p["tab_id"] == tab["tab_id"])
        receipt["created_panes"].append(first_split["pane_id"])
        save()
        split = cli("pane", "split", first_split["pane_id"], "--direction", "right", "--cwd", str(h.ROOT), "--no-focus")["pane"]
        receipt["created_panes"].append(split["pane_id"])
        save()
        assert snapshot()["focused_pane_id"] == original_pane, "no-focus creation changed original focus"
        assert all(p.get("agent") is None for p in snapshot()["panes"] if p["workspace_id"] == owned_workspace)
        cli("pane", "zoom", first_split["pane_id"], "--on")
        cases = [("workspace", owned_workspace), ("tab", tab["tab_id"]), ("pane", split["pane_id"]), ("agent", self_pane)]
        zoom_before = {row["tab_id"]: row["zoomed"] for row in snapshot()["layouts"]}
        for mode in ("direct_handler_process", "registered_plugin_action"):
            for kind, target in cases:
                focus(origin["pane_id"])
                url = h.navigation_url(kind, target, socket_path, version=baseline["version"])
                if mode == "registered_plugin_action":
                    log = plugin_action(url, origin)
                    assert log["status"] == "succeeded" and log["exit_code"] == 0, log
                    evidence = {"log_id": log["log_id"], "exit_code": log["exit_code"], "stdout": log.get("stdout")}
                else:
                    context = {
                        "invocation_source": "link_click", "clicked_url": url, "link_handler_id": h.LINK_HANDLER_ID,
                        "workspace_id": origin["workspace_id"], "tab_id": origin["tab_id"], "focused_pane_id": origin["pane_id"],
                    }
                    environment = {
                        **os.environ, "HERDR_PLUGIN_ID": h.PLUGIN_ID, "HERDR_PLUGIN_ACTION_ID": h.ACTION_ID,
                        "HERDR_PLUGIN_LINK_HANDLER_ID": h.LINK_HANDLER_ID, "HERDR_PLUGIN_CLICKED_URL": url,
                        "HERDR_PLUGIN_CONTEXT_JSON": json.dumps(context), "HERDR_PANE_ID": origin["pane_id"],
                        "HERDR_WORKSPACE_ID": origin["workspace_id"], "HERDR_TAB_ID": origin["tab_id"],
                    }
                    completed = subprocess.run([str(h.ROOT / "bin/herdr-links"), "handle"], env=environment, shell=False,
                                               capture_output=True, text=True, timeout=10)
                    assert completed.returncode == 0, completed.stderr
                    evidence = {"exit_code": completed.returncode, "stdout": completed.stdout}
                after = snapshot()
                key = {"agent": "focused_pane_id", "pane": "focused_pane_id", "tab": "focused_tab_id", "workspace": "focused_workspace_id"}[kind]
                assert after[key] == target, (mode, kind, target, after[key])
                assert all(row["zoomed"] == zoom_before[row["tab_id"]] for row in after["layouts"] if row["tab_id"] in zoom_before)
                receipt["checks"].append({"mode": mode, "kind": kind, "target": target, "observed_focus": after[key], "zoom_preserved": True, **evidence})
                save()
        focus(origin["pane_id"])
        invalid = h.navigation_url("agent", origin["pane_id"], socket_path, version=baseline["version"])
        log = plugin_action(invalid, origin)
        assert log["status"] == "failed" and log["exit_code"] == 1, log
        assert snapshot()["focused_pane_id"] == origin["pane_id"]
        receipt["checks"].append({"mode": "registered_plugin_action", "case": "ordinary shell as agent rejected", "log_id": log["log_id"], "exit_code": log["exit_code"], "stderr": log.get("stderr"), "focus_unchanged": True})
        stale_url = h.navigation_url("pane", split["pane_id"], socket_path, version=baseline["version"])
        cli("pane", "close", split["pane_id"])
        log = plugin_action(stale_url, origin)
        assert log["status"] == "failed" and log["exit_code"] == 1, log
        assert snapshot()["focused_pane_id"] == origin["pane_id"]
        receipt["checks"].append({"mode": "registered_plugin_action", "case": "closed pane rejected", "log_id": log["log_id"], "exit_code": log["exit_code"], "stderr": log.get("stderr"), "focus_unchanged": True})
        if baseline["version"] == "0.9.0":
            focus(origin["pane_id"])
            url = h.navigation_url("agent", self_pane, socket_path, version=baseline["version"])
            marker = "HERDR_LINK_ACTIVATION_HIT"
            payload = f"\x1b[2J\x1b[H\x1b]8;;{url}\x1b\\{marker}\x1b]8;;\x1b\\\n".encode()
            encoded = base64.b64encode(payload).decode()
            code = f"import base64,sys;sys.stdout.buffer.write(base64.b64decode({encoded!r}));sys.stdout.flush()"
            plain_cli("pane", "run", origin["pane_id"], f"python3 -c {shlex.quote(code)}")
            plain_cli("pane", "wait-output", origin["pane_id"], "--match", marker, "--timeout", "5000")
            before = {
                row["log_id"]
                for row in h.api_request(
                    socket_path, "plugin.log.list", {"plugin_id": h.PLUGIN_ID, "limit": 100}, "plugin_log_list"
                )["logs"]
            }
            activation = h.api_request(
                socket_path,
                "pane.link.activate",
                {"pane_id": origin["pane_id"], "viewport_row": 0, "col": 0, "content_revision": None, "offset_from_bottom": 0},
                "pane_link_activated",
            )
            assert activation.get("url") == url and activation.get("handled") is True, activation
            activation_log = None
            for _ in range(50):
                logs = h.api_request(
                    socket_path, "plugin.log.list", {"plugin_id": h.PLUGIN_ID, "limit": 100}, "plugin_log_list"
                )["logs"]
                candidates = [row for row in logs if row["log_id"] not in before and row.get("action_id") == h.ACTION_ID]
                if candidates and candidates[-1]["status"] != "running":
                    activation_log = candidates[-1]
                    break
                time.sleep(0.1)
            assert activation_log and activation_log["status"] == "succeeded", activation_log
            assert snapshot()["focused_pane_id"] == self_pane
            receipt["checks"].append({
                "mode": "pane.link.activate",
                "case": "custom OSC8 hit-test and registered handler dispatch",
                "url": activation["url"],
                "handled": activation["handled"],
                "log_id": activation_log["log_id"],
                "exit_code": activation_log["exit_code"],
                "observed_focus": self_pane,
                "physical_mouse_event": False,
            })
        receipt["result"] = "passed"
    except Exception as error:
        receipt["result"] = "failed"
        receipt["error"] = repr(error)
        raise
    finally:
        try:
            state = snapshot()
            if any(p["pane_id"] == original_pane for p in state["panes"]):
                focus(original_pane)
                receipt["focus_restored"] = snapshot()["focused_pane_id"] == original_pane
            else:
                receipt["focus_restored"] = False
            if owned_workspace:
                state = snapshot()
                workspace = next(w for w in state["workspaces"] if w["workspace_id"] == owned_workspace)
                current_panes = {p["pane_id"] for p in state["panes"] if p["workspace_id"] == owned_workspace}
                assert workspace["label"] == label and current_panes <= set(receipt["created_panes"]), "ownership changed; manual cleanup required"
                cli("workspace", "close", owned_workspace)
                receipt["owned_workspace_removed"] = not any(w["workspace_id"] == owned_workspace for w in snapshot()["workspaces"])
        finally:
            receipt["finished"] = datetime.now(timezone.utc).isoformat()
            save()
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    main()
