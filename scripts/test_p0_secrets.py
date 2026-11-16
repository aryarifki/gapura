import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest


spec = importlib.util.spec_from_file_location('p0_secrets', Path(__file__).with_name('p0_secrets.py'))
secrets = importlib.util.module_from_spec(spec)
spec.loader.exec_module(secrets)


class PrivateSecretsTest(unittest.TestCase):
    def test_pipeline_unit_uses_protected_runtime_environment(self):
        unit = (Path(__file__).resolve().parents[1] / 'deploy/gapura-pipeline.service').read_text()
        self.assertIn('EnvironmentFile=/etc/gapura/runtime.env', unit)
        self.assertNotIn('EnvironmentFile=/root/gapura/.env', unit)
        self.assertIn('Environment=GAPURA_ENABLE_DELIVERY=false', unit)

    def test_replaces_every_duplicate_without_changing_unrelated_settings(self):
        original = '# keep comments\nPORT=3005\nRENDER_SECRET=old\nRENDER_SECRET=stale\nGEMINI_API_KEY=provider\n'
        result = secrets.replace_env_values(original, {'RENDER_SECRET': 'new-secret', 'N8N_ENCRYPTION_KEY': 'new-key'})
        self.assertEqual(result.count('RENDER_SECRET='), 1)
        self.assertIn('RENDER_SECRET=new-secret\n', result)
        self.assertIn('# keep comments\nPORT=3005\n', result)
        self.assertIn('GEMINI_API_KEY=provider\n', result)
        self.assertIn('N8N_ENCRYPTION_KEY=new-key\n', result)

    def test_rejects_values_that_could_inject_environment_or_shell_commands(self):
        for value in ['secret\nOTHER=bad', '$(id)', '`id`', 'secret;id', 'secret\x00']:
            with self.subTest(value=repr(value)), self.assertRaises(ValueError):
                secrets.replace_env_values('', {'RENDER_SECRET': value})

    def test_atomic_secret_file_is_private_and_symlink_is_not_followed(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory, 'runtime.env')
            target.write_text('old')
            target.chmod(0o644)
            secrets.atomic_private_write(target, 'new')
            self.assertEqual(target.read_text(), 'new')
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
            link = Path(directory, 'linked.env')
            link.symlink_to(target)
            with self.assertRaises(ValueError):
                secrets.atomic_private_write(link, 'injected')
            self.assertEqual(target.read_text(), 'new')
            self.assertEqual(sorted(p.name for p in Path(directory).iterdir()), ['linked.env', 'runtime.env'])

    def test_n8n_rotation_preserves_config_and_refuses_existing_credentials(self):
        original = json.dumps({'encryptionKey': 'old', 'other': {'unchanged': True}})
        rotated = json.loads(secrets.rotate_n8n_config(original, 'new-key', credentials_count=0))
        self.assertEqual(rotated, {'encryptionKey': 'new-key', 'other': {'unchanged': True}})
        with self.assertRaisesRegex(ValueError, 'credential'):
            secrets.rotate_n8n_config(original, 'new-key', credentials_count=1)

    def test_gemini_install_validates_before_write_and_clears_shadow_key(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory, 'runtime.env')
            target.write_text('PORT=3005\nGEMINI_API_KEY=old-key\nGOOGLE_API_KEY=shadow-key\n')
            before = target.read_text()
            with self.assertRaisesRegex(RuntimeError, 'validation'):
                secrets.install_gemini_key('replacement-key-value-1234567890', target, 'fixture-model',
                    validate=lambda *_: (_ for _ in ()).throw(RuntimeError('validation failed')))
            self.assertEqual(target.read_text(), before)
            calls = []
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                secrets.install_gemini_key('replacement-key-value-1234567890', target, 'fixture-model',
                    validate=lambda key, model: calls.append((key, model)))
            self.assertEqual(calls, [('replacement-key-value-1234567890', 'fixture-model')])
            self.assertIn('GEMINI_API_KEY=replacement-key-value-1234567890\n', target.read_text())
            self.assertIn('GOOGLE_API_KEY=\n', target.read_text())
            self.assertNotIn('replacement-key', out.getvalue())
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)

    def test_revocation_containment_removes_primary_and_shadow_key(self):
        original = 'PORT=3005\nGEMINI_API_KEY=old-key\nGOOGLE_API_KEY=shadow-key\n'
        cleared = secrets.remove_gemini_keys(original)
        self.assertIn('GEMINI_API_KEY=\n', cleared)
        self.assertIn('GOOGLE_API_KEY=\n', cleared)
        self.assertIn('PORT=3005\n', cleared)
        self.assertNotIn('old-key', cleared)
        self.assertNotIn('shadow-key', cleared)

    def test_scram_password_verifier_authenticates_only_the_new_password(self):
        import base64
        import hashlib
        import hmac
        password = 'new-hex-password'
        verifier = secrets.scram_verifier(password)
        mechanism, parameters, keys = verifier.split('$')
        iterations, salt = parameters.split(':')
        stored_key, _ = keys.split(':')
        self.assertEqual(mechanism, 'SCRAM-SHA-256')
        for candidate, expected in [(password, True), ('old-password', False)]:
            salted = hashlib.pbkdf2_hmac('sha256', candidate.encode(), base64.b64decode(salt), int(iterations))
            derived = hashlib.sha256(hmac.new(salted, b'Client Key', hashlib.sha256).digest()).digest()
            self.assertEqual(hmac.compare_digest(derived, base64.b64decode(stored_key)), expected)
        self.assertNotIn(password, verifier)


if __name__ == '__main__':
    unittest.main()
