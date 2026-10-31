# vim:set expandtab shiftwidth=4 filetype=python:
# SPDX-License-Identifier: GPL-3.0-only

#
#
# ~chewygumxx/dorothy.git
# ::: :/packages/cli/assets/hermes/dorothy/__init__.py
#
#

"""Dorothy's memory for Hermes Agent: her opening block, frozen for the
session, and recall for each prompt, both from `dorothy --hook hermes`,
which finds the project, caches the block and fails open itself. Her
tools come from her MCP server; her sweep records the sessions."""

import json
import os
import subprocess

from agent.memory_provider import MemoryProvider

CONFIG = "dorothy.json"
# Inside the 8 seconds Hermes gives an external provider's prefetch.
TIMEOUT = 6.0


def _home():
    return os.environ.get("HERMES_HOME") or os.path.expanduser("~/.hermes")


def _configured_command():
    try:
        with open(os.path.join(_home(), CONFIG)) as f:
            command = json.load(f).get("command")
    except (OSError, ValueError, AttributeError):
        return None
    if isinstance(command, list) and all(isinstance(w, str) for w in command):
        return command
    return None


class DorothyProvider(MemoryProvider):
    def __init__(self, command=None, cwd=None, timeout=TIMEOUT):
        self._command = command
        self._cwd = cwd
        self._timeout = timeout
        self._session = ""
        self._block = None

    @property
    def name(self):
        return "dorothy"

    def is_available(self):
        return self._command is not None

    def unavailable_reason(self):
        return "run `dorothy --install hermes` to set her provider up"

    def initialize(self, session_id, **kwargs):
        self._session = session_id or ""
        self._cwd = self._cwd or kwargs.get("cwd") or os.getcwd()

    def _hook(self, event, payload):
        if self._command is None:
            return ""
        try:
            done = subprocess.run(
                [*self._command, "--hook", "hermes", event],
                input=json.dumps(payload),
                capture_output=True,
                text=True,
                timeout=self._timeout,
            )
            if done.returncode != 0 or done.stdout.strip() == "":
                return ""
            text = json.loads(done.stdout)["hookSpecificOutput"]["additionalContext"]
            return text if isinstance(text, str) else ""
        except (OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired):
            return ""

    def system_prompt_block(self):
        if self._block is None:
            self._block = self._hook(
                "session-start",
                {"session_id": self._session, "cwd": self._cwd, "source": "startup"},
            )
        return self._block

    def prefetch(self, query, *, session_id=""):
        return self._hook(
            "prompt",
            {"session_id": session_id or self._session, "cwd": self._cwd, "prompt": query},
        )

    def queue_prefetch(self, query, *, session_id=""):
        # Hermes calls this once a turn is over, with that turn's text.
        return None

    def sync_turn(self, *args, **kwargs):
        # Her sweep records Hermes's sessions.
        return None

    def get_tool_schemas(self):
        return []

    def handle_tool_call(self, tool_name, args, **kwargs):
        return json.dumps({"error": f"dorothy has no tool {tool_name}"})

    def shutdown(self):
        return None


def register(ctx):
    ctx.register_memory_provider(DorothyProvider(command=_configured_command()))
