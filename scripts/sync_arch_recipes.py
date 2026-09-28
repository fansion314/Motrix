#!/usr/bin/env python3
"""Restore the four AUR recipe files from a checksum-verified Arch release."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile

FILES = [f'aur/{name}/{file}' for name in ['motrix2', 'motrix2-bin'] for file in ['PKGBUILD', '.SRCINFO']]


def parse_tag(tag):
    match = re.fullmatch(r'arch-v(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?-([1-9]\d*)', tag)
    if not match:
        raise ValueError('Invalid Arch release tag')
    major, minor, patch, beta, revision = match.groups()
    key = (*map(int, (major, minor, patch)), int(beta is None), int(beta or 0), int(revision))
    return key, tag.removeprefix('arch-v').rsplit('-', 1)[0], revision


def recipe_tag(text):
    version = re.search(r'^_version=([\w.+-]+)$', text, re.M)
    revision = re.search(r'^pkgrel=([1-9]\d*)$', text, re.M)
    if not version or not revision:
        raise ValueError('Missing recipe version')
    return f'arch-v{version[1]}-{revision[1]}'


def checked_files(archive, tag, application_digest):
    _, version, revision = parse_tag(tag)
    files = {}
    with tarfile.open(archive) as tar:
        for member in tar:
            if member.isdir() and member.name.rstrip('/') in ['aur', 'aur/motrix2', 'aur/motrix2-bin']:
                continue
            if member.name not in FILES or not member.isfile() or member.size > 65536 or member.name in files:
                raise ValueError(f'Unexpected recipe archive entry: {member.name}')
            files[member.name] = tar.extractfile(member).read().decode()
    if set(files) != set(FILES):
        raise ValueError('Incomplete recipe archive')
    for name in ['motrix2', 'motrix2-bin']:
        recipe = files[f'aur/{name}/PKGBUILD']
        if recipe_tag(recipe) != tag or not re.search(rf'^pkgname={name}$', recipe, re.M):
            raise ValueError('Recipe identity differs from release')
        srcinfo = files[f'aur/{name}/.SRCINFO']
        for field, expected in [('pkgbase', name), ('pkgname', name), ('pkgver', version.replace('-', '')), ('pkgrel', revision)]:
            if not re.search(rf'^\s*{field} = {re.escape(expected)}$', srcinfo, re.M):
                raise ValueError(f'Invalid .SRCINFO {field}')
    if not re.search(rf"^sha256sums=\('{application_digest}'\)$", files['aur/motrix2-bin/PKGBUILD'], re.M):
        raise ValueError('Binary recipe checksum differs from the application')
    if f'sha256sums = {application_digest}' not in files['aur/motrix2-bin/.SRCINFO']:
        raise ValueError('Binary .SRCINFO checksum differs from the application')
    return files


def apply_files(root, files, tag):
    incoming = parse_tag(tag)[0]
    for name in ['motrix2', 'motrix2-bin']:
        existing_recipe = (root/f'aur/{name}/PKGBUILD').read_text()
        current = parse_tag(recipe_tag(existing_recipe))[0]
        if current > incoming:
            print('Default branch already has a newer recipe; skipping old release.')
            return False
        if current == incoming and existing_recipe != files[f'aur/{name}/PKGBUILD']:
            raise ValueError('Refusing same-version recipe replacement; increment pkgrel')
    changed = [file for file in FILES if (root/file).read_text() != files[file]]
    # A same-version retry may repair stale metadata, but never change pinned payload bytes.
    existing = (root/'aur/motrix2-bin/PKGBUILD').read_text()
    if parse_tag(recipe_tag(existing))[0] == incoming:
        digest = re.search(r"^sha256sums=\('([a-f0-9]{64})'\)$", existing, re.M)
        new_digest = re.search(r"^sha256sums=\('([a-f0-9]{64})'\)$", files['aur/motrix2-bin/PKGBUILD'], re.M)
        if digest and new_digest and digest[1] != new_digest[1]:
            raise ValueError('Refusing same-version binary replacement')
    for file in changed:
        (root/file).write_text(files[file])
    print(f'Updated {len(changed)} recipe files for {tag}')
    return bool(changed)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tag', required=True)
    parser.add_argument('--repository', default='fansion314/Motrix', choices=['fansion314/Motrix'])
    args = parser.parse_args()
    _, version, revision = parse_tag(args.tag)
    release = json.loads(subprocess.check_output(['gh', 'release', 'view', args.tag, '--repo', args.repository,
                                                  '--json', 'isDraft,assets'], text=True))
    if release['isDraft']:
        raise ValueError('Refusing draft release')
    archive = f'motrix2-{version}-{revision}-aur.tar.gz'
    application = f'motrix2-{version}-{revision}-x86_64.asar'
    with tempfile.TemporaryDirectory(prefix='motrix-arch-sync-') as directory:
        subprocess.run(['gh', 'release', 'download', args.tag, '--repo', args.repository,
                        '--pattern', archive, '--pattern', application, '--pattern', 'SHA256SUMS', '--dir', directory], check=True)
        sums = {}
        for line in (Path(directory)/'SHA256SUMS').read_text().splitlines():
            fields = line.split()
            if len(fields) != 2 or not re.fullmatch('[a-f0-9]{64}', fields[0]) or fields[1] in sums:
                raise ValueError('Invalid release checksum list')
            sums[fields[1]] = fields[0]
        for name in [archive, application]:
            with (Path(directory)/name).open('rb') as stream:
                actual = hashlib.file_digest(stream, 'sha256').hexdigest()
            assets = [asset for asset in release['assets'] if asset['name'] == name]
            if len(assets) != 1 or sums.get(name) != actual or assets[0].get('digest') != 'sha256:' + actual:
                raise ValueError(f'Published checksum mismatch: {name}')
        apply_files(Path.cwd(), checked_files(Path(directory)/archive, args.tag, sums[application]), args.tag)


if __name__ == '__main__':
    main()
