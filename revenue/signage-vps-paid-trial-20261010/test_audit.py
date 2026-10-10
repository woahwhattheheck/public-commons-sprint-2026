import unittest
from audit import parse_listeners, parse_sshd, parse_ufw


class ParsingAcceptanceTests(unittest.TestCase):
    def test_public_listeners_keep_only_public_tcp(self):
        raw = ('LISTEN 0 4096 127.0.0.1:18789 0.0.0.0:*\n'
               'LISTEN 0 128 0.0.0.0:22 0.0.0.0:*\n'
               'LISTEN 0 128 [::]:3000 [::]:*\n')
        self.assertEqual(parse_listeners(raw), [22, 3000])
        self.assertIsNone(parse_listeners(None))

    def test_ufw_default_deny_and_no_public_app_port(self):
        clean = ('Status: active\nDefault: deny (incoming), allow (outgoing), disabled (routed)\n'
                 '22/tcp ALLOW IN Anywhere\n22/tcp (v6) ALLOW IN Anywhere (v6)\n')
        self.assertTrue(parse_ufw(clean))
        self.assertFalse(parse_ufw(clean + '3000/tcp ALLOW IN Anywhere\n'))
        self.assertFalse(parse_ufw(clean.replace('deny (incoming)', 'allow (incoming)')))
        self.assertIsNone(parse_ufw(None))

    def test_sshd_effective_key_only(self):
        clean = ('passwordauthentication no\nkbdinteractiveauthentication no\n'
                 'pubkeyauthentication yes\npermitrootlogin no\nport 22\n')
        self.assertTrue(parse_sshd(clean))
        self.assertFalse(parse_sshd(clean.replace('passwordauthentication no', 'passwordauthentication yes')))
        self.assertFalse(parse_sshd(clean.replace('port 22', 'port 2222')))
        self.assertIsNone(parse_sshd(None))


if __name__ == '__main__':
    unittest.main()