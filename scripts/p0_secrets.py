#!/usr/bin/env python3
"""Private secret updates. Never pass secret values as command-line arguments."""
import argparse
import base64
import getpass
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


def replace_env_values(text, replacements):
    for name, value in replacements.items():
        if not re.fullmatch(r'[A-Z][A-Z0-9_]*', name) or not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_./:@+,=-]*', value):
            raise ValueError('Unsafe environment name or value.')
    result, written = [], set()
    for line in text.splitlines():
        name = line.split('=', 1)[0].strip()
        if name in replacements:
            if name not in written:
                result.append(f'{name}={replacements[name]}')
                written.add(name)
        else:
            result.append(line)
    result.extend(f'{name}={value}' for name, value in replacements.items() if name not in written)
    return '\n'.join(result) + '\n'


def remove_gemini_keys(text):
    return replace_env_values(text, {'GEMINI_API_KEY': '', 'GOOGLE_API_KEY': ''})


def atomic_private_write(path, content):
    path = Path(path)
    if path.is_symlink():
        raise ValueError('Refusing a symlink as the secret destination.')
    descriptor, temporary = tempfile.mkstemp(prefix=f'.{path.name}.', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w') as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def rotate_n8n_config(text, key, *, credentials_count):
    if credentials_count != 0:
        raise ValueError('Existing n8n credentials require a decrypt/re-encrypt migration before key rotation.')
    config = json.loads(text)
    config['encryptionKey'] = key
    return json.dumps(config, indent=2) + '\n'


def scram_verifier(password):
    salt, iterations = os.urandom(16), 4096
    salted = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, iterations)
    stored = hashlib.sha256(hmac.new(salted, b'Client Key', hashlib.sha256).digest()).digest()
    server = hmac.new(salted, b'Server Key', hashlib.sha256).digest()
    encode = lambda value: base64.b64encode(value).decode()
    return f'SCRAM-SHA-256${iterations}:{encode(salt)}${encode(stored)}:{encode(server)}'


def validate_gemini_key(key, model):
    request = Request(
        f'https://generativelanguage.googleapis.com/v1beta/models/{quote(model, safe="")}:generateContent',
        headers={'Content-Type': 'application/json', 'x-goog-api-key': key},
        data=json.dumps({'contents': [{'parts': [{'text': 'Return only JSON {"ok":true}.'}]}],
                         'generationConfig': {'responseMimeType': 'application/json'}}).encode(),
    )
    try:
        with urlopen(request, timeout=20) as response:
            result = json.load(response)
        parts = result.get('candidates', [{}])[0].get('content', {}).get('parts', [])
        text = ''.join(part.get('text', '') for part in parts if not part.get('thought'))
        if not text.strip():
            raise ValueError('empty response')
        json.loads(text)
    except HTTPError as error:
        raise RuntimeError(f'Gemini validation failed (HTTP {error.code}); runtime was not changed.') from None
    except (URLError, TimeoutError, ValueError, IndexError):
        raise RuntimeError('Gemini validation failed; runtime was not changed.') from None


def install_gemini_key(key, path, model, *, validate=validate_gemini_key):
    path = Path(path)
    if path.is_symlink():
        raise ValueError('Use the private runtime destination, not a symlink.')
    if not isinstance(key, str) or not re.fullmatch(r'[A-Za-z0-9_.-]{20,512}', key):
        raise ValueError('Invalid API key format.')
    original = path.read_text()
    updated = replace_env_values(original, {'GEMINI_API_KEY': key, 'GOOGLE_API_KEY': ''})
    if updated == original:
        raise ValueError('Replacement key must differ from the active key.')
    validate(key, model)
    atomic_private_write(path, updated)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['install-gemini'])
    parser.add_argument('--runtime', default='/etc/gapura/runtime.env')
    parser.add_argument('--model', default=None)
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.exit(1, 'Run as root to update the protected runtime file.\n')
    try:
        model = args.model
        if not model:
            config = json.loads((Path(__file__).resolve().parents[1] / 'config/agents.json').read_text())
            model = config['studio']['model']
        key = getpass.getpass('New Gemini API key (hidden): ')
        install_gemini_key(key, args.runtime, model)
        subprocess.run(['systemctl', 'restart', 'hme-web'], check=True, capture_output=True)
        if not health_check('http://127.0.0.1:3005/health'):
            parser.exit(1, 'Web service health verification failed. Key was installed; restore from the protected backup and inspect service status.\n')
        print('Replacement key validated and installed. hme-web restarted.')
        print('Revoke the previous key in Google AI Studio after confirming the agent test succeeds.')
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        # Never echo exceptions that might include request headers, bodies or keys.
        parser.exit(1, 'Secret installation failed; check the key, provider quota and local service status. No key was printed.\n')


def health_check(url):
    try:
        with urlopen(url, timeout=4) as response:
            return response.status == 200
    except Exception:
        return False


if __name__ == '__main__':
    main()
