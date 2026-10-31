# vim:set expandtab shiftwidth=4 filetype=python:
# SPDX-License-Identifier: GPL-3.0-only

#
#
# ~chewygumxx/dorothy.git
# ::: :/packages/cli/assets/hermes/test_dorothy.py
#
#

import json
import os
import sys
import tempfile
import types
import unittest
from abc import ABC

agent = types.ModuleType("agent")
memory_provider = types.ModuleType("agent.memory_provider")


class MemoryProvider(ABC):
    pass


memory_provider.MemoryProvider = MemoryProvider
sys.modules["agent"] = agent
sys.modules["agent.memory_provider"] = memory_provider
sys.path.insert(0, os.path.dirname(__file__))

import dorothy  # noqa: E402


def script(body):
    handle, path = tempfile.mkstemp()
    with os.fdopen(handle, "w") as f:
        f.write("#!/bin/sh\n" + body)
    os.chmod(path, 0o755)
    return [path]


def reply(text, event):
    return json.dumps(
        {"hookSpecificOutput": {"hookEventName": event, "additionalContext": text}}
    )


class ProviderTest(unittest.TestCase):
    def provider(self, command):
        provider = dorothy.DorothyProvider(command=command, cwd="/tmp/project")
        provider.initialize("s-1")
        return provider

    def test_block_is_fetched_once_and_frozen(self):
        count = tempfile.mktemp()
        command = script(
            f"echo x >> {count}; cat >/dev/null; echo '{reply('BLOCK', 'SessionStart')}'\n"
        )
        provider = self.provider(command)
        self.assertEqual(provider.system_prompt_block(), "BLOCK")
        self.assertEqual(provider.system_prompt_block(), "BLOCK")
        with open(count) as f:
            self.assertEqual(len(f.readlines()), 1)

    def test_prefetch_recalls_for_the_current_prompt(self):
        seen = tempfile.mktemp()
        command = script(
            f"cat > {seen}; echo '{reply('RECALL', 'UserPromptSubmit')}'\n"
        )
        provider = self.provider(command)
        self.assertEqual(provider.prefetch("what now?", session_id="s-1"), "RECALL")
        with open(seen) as f:
            payload = json.load(f)
        self.assertEqual(payload["prompt"], "what now?")
        self.assertEqual(payload["session_id"], "s-1")
        self.assertEqual(payload["cwd"], "/tmp/project")

    def test_queue_prefetch_and_sync_turn_do_nothing(self):
        provider = self.provider(script("exit 1\n"))
        self.assertIsNone(provider.queue_prefetch("x"))
        self.assertIsNone(provider.sync_turn("u", "a"))
        self.assertEqual(provider.get_tool_schemas(), [])

    def test_fails_open(self):
        for command in (script("exit 3\n"), script("echo not-json\n"),
                        ["/nonexistent/dorothy"], script("sleep 30\n")):
            provider = dorothy.DorothyProvider(
                command=command, cwd="/tmp", timeout=1.0
            )
            provider.initialize("s")
            self.assertEqual(provider.system_prompt_block(), "")
            self.assertEqual(provider.prefetch("q"), "")

    def test_unavailable_without_its_command(self):
        provider = dorothy.DorothyProvider(command=None, cwd="/tmp")
        self.assertFalse(provider.is_available())
        self.assertIn("dorothy --install hermes", provider.unavailable_reason())


if __name__ == "__main__":
    unittest.main()
