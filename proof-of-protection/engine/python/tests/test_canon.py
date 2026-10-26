import unittest

from proofengine import canon


class Canon(unittest.TestCase):
    def test_encode_sorts_and_compacts(self):
        v = {"b": 2, "a": [True, False, "x"], "_": {"z": -5, "y": ""}}
        self.assertEqual(canon.encode(v), b'{"_":{"y":"","z":-5},"a":[true,false,"x"],"b":2}')

    def test_rejects(self):
        for bad in [b'{"a": 1}', b'{"b":1,"a":2}', b'{"a":1,"a":1}', b'{"a":1.0}', b'{"a":1e3}', b'{"a":-0}',
                    b'{"a":null}', b'{"a":"\\u0041"}', '{"a":"\u00e9"}'.encode(), b'{"a":9007199254740992}',
                    b'{"a":1}{}', b'{"a":1}\n', b'{"":1}', b'{"a":"\xff"}', b'{"a":NaN}', b'{"a":"\\ud800"}']:
            with self.assertRaises(canon.CanonError, msg=bad):
                canon.parse(bad)

    def test_python_types_are_strict(self):
        for bad in [1.5, None, {"a": None}, "line\nbreak", 'quote"', {1: "x"}, 2**53, (1, 2)]:
            with self.assertRaises(canon.CanonError, msg=repr(bad)):
                canon.encode(bad)
        self.assertEqual(canon.encode(True), b"true")  # bool is not encoded as 1

    def test_container_allows_unicode_but_not_duplicates(self):
        self.assertEqual(canon.parse_container('{"name":"M\\u00fcller & Co"}'.encode()), {"name": "Müller & Co"})
        with self.assertRaises(canon.CanonError):
            canon.parse_container(b'{"a":1,"a":2}')


if __name__ == "__main__":
    unittest.main()
