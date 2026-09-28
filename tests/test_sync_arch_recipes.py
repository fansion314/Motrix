import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('sync', Path(__file__).parents[1]/'scripts/sync_arch_recipes.py')
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)


def recipes(revision, digest='a'*64):
    files = {}
    for name in ['motrix-electron', 'motrix-electron-bin']:
        files[f'aur/{name}/PKGBUILD'] = f"pkgname={name}\npkgver=2.0.0beta.41\npkgrel={revision}\n_version=2.0.0-beta.41\nsha256sums=('{digest}')\n"
        files[f'aur/{name}/.SRCINFO'] = f'pkgbase = {name}\npkgname = {name}\npkgver = 2.0.0beta.41\npkgrel = {revision}\nsha256sums = {digest}\n'
    return files


class RecipeSyncTests(unittest.TestCase):
    def test_release_order_and_input_validation(self):
        self.assertGreater(sync.parse_tag('arch-v2.0.0-beta.41-10')[0], sync.parse_tag('arch-v2.0.0-beta.41-2')[0])
        self.assertGreater(sync.parse_tag('arch-v2.0.0-1')[0], sync.parse_tag('arch-v2.0.0-beta.99-2')[0])
        with self.assertRaises(ValueError):
            sync.parse_tag('arch-v2.0.0-1;echo bad')

    def test_update_retry_and_old_job(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for file, text in recipes(1).items():
                (root/file).parent.mkdir(parents=True, exist_ok=True)
                (root/file).write_text(text)
            self.assertTrue(sync.apply_files(root, recipes(2), 'arch-v2.0.0-beta.41-2'))
            self.assertFalse(sync.apply_files(root, recipes(2), 'arch-v2.0.0-beta.41-2'))
            self.assertFalse(sync.apply_files(root, recipes(1), 'arch-v2.0.0-beta.41-1'))
            with self.assertRaisesRegex(ValueError, 'same-version'):
                sync.apply_files(root, recipes(2, 'b'*64), 'arch-v2.0.0-beta.41-2')

    def test_same_version_unpinned_template_accepts_published_checksum(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            template = recipes(2)
            template['aur/motrix-electron-bin/PKGBUILD'] = template['aur/motrix-electron-bin/PKGBUILD'].replace("sha256sums=('" + 'a'*64 + "')", "sha256sums=('SKIP')")
            for file, content in template.items():
                (root/file).parent.mkdir(parents=True, exist_ok=True)
                (root/file).write_text(content)
            self.assertTrue(sync.apply_files(root, recipes(2), 'arch-v2.0.0-beta.41-2'))

    def test_archive_identity_and_extra_entries(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory)/'recipes.tar.gz'
            for extra in [False, True]:
                with tarfile.open(archive, 'w:gz') as tar:
                    for name, text in recipes(2).items():
                        data = text.encode()
                        member = tarfile.TarInfo(name)
                        member.size = len(data)
                        tar.addfile(member, io.BytesIO(data))
                    if extra:
                        member = tarfile.TarInfo('../../outside')
                        tar.addfile(member, io.BytesIO())
                if extra:
                    with self.assertRaises(ValueError):
                        sync.checked_files(archive, 'arch-v2.0.0-beta.41-2', 'a'*64)
                else:
                    self.assertEqual(sync.checked_files(archive, 'arch-v2.0.0-beta.41-2', 'a'*64), recipes(2))


if __name__ == '__main__':
    unittest.main()
