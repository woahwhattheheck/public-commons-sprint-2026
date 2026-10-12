// SPDX-License-Identifier: Apache-2.0
// Released ODK Central fixtures, retained from the exact upstream source listed below.
// CB57 change: compose those originals and the explicitly recorded upstream versioning
// substitutions into a source-only constant for the existing native host driver.
// The original license is included in CENTRAL_FIXTURES_LICENSE.txt.
function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
export const RELEASED_FIXTURES = deepFreeze({
  "schema": "stellar-forge.odk-released-native-fixtures.v1",
  "upstream": {
    "repository": "getodk/central-backend",
    "commit": "de0d2a07fd7c9ff698cbc312e550dd40ff058340",
    "files": [
      {
        "path": "test/data/xml.js",
        "blobSha": "e21ee6964421f30dbe32e93cf476735430358a1e"
      },
      {
        "path": "test/integration/api/submissions.js",
        "blobSha": "0658f4ef3f0eb9917917bcd067fed4f093745d5e"
      },
      {
        "path": "test/integration/api/odata.js",
        "blobSha": "361a346227094d7f5521b2ea054d0bf565ca6548"
      },
      {
        "path": "lib/resources/forms.js",
        "blobSha": "d5bae185f6e2ce0ea4652c2da7c8b097ad267aa7"
      },
      {
        "path": "lib/resources/submissions.js",
        "blobSha": "516b66ffeec955ba7cc0f9fd410f4e87779f5f2a"
      }
    ],
    "license": {
      "spdx": "Apache-2.0",
      "path": "LICENSE",
      "url": "https://github.com/getodk/central-backend/blob/de0d2a07fd7c9ff698cbc312e550dd40ff058340/LICENSE",
      "bytes": 11358,
      "sha256": "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
      "distributionFile": "CENTRAL_FIXTURES_LICENSE.txt"
    }
  },
  "purpose": "Exercise the released Central API through the existing host and original field workspace, using upstream fixture data. These constants do not create a host, contact a customer, or assert a completed native run.",
  "scope": {
    "pageSize": 2
  },
  "forms": [
    {
      "key": "doubleRepeat",
      "formId": "doubleRepeat",
      "versions": [
        {
          "version": "1.0",
          "versionRouteToken": "1.0",
          "xml": "<?xml version=\"1.0\"?>\n<h:html xmlns=\"http://www.w3.org/2002/xforms\" xmlns:h=\"http://www.w3.org/1999/xhtml\" xmlns:ev=\"http://www.w3.org/2001/xml-events\" xmlns:xsd=\"http://www.w3.org/2001/XMLSchema\" xmlns:jr=\"http://openrosa.org/javarosa\" xmlns:orx=\"http://openrosa.org/xforms\">\n  <h:head>\n    <model>\n      <instance>\n        <data id=\"doubleRepeat\" orx:version=\"1.0\">\n          <orx:meta>\n            <orx:instanceID/>\n          </orx:meta>\n          <name/>\n          <children>\n            <child>\n              <name/>\n              <toys>\n                <toy>\n                  <name/>\n                </toy>\n              </toys>\n            </child>\n          </children>\n        </data>\n      </instance>\n      <bind nodeset=\"/data/orx:meta/orx:instanceID\" preload=\"uid\" type=\"string\"/>\n      <bind nodeset=\"/data/name\" type=\"string\"/>\n      <bind nodeset=\"/data/children/child/name\" type=\"string\"/>\n      <bind nodeset=\"/data/children/child/toys/toy/name\" type=\"string\"/>\n    </model>\n  </h:head>\n  <h:body>\n    <input ref=\"/data/name\">\n      <label>What is your name?</label>\n    </input>\n    <group ref=\"/data/children/child\">\n      <label>Child</label>\n      <repeat nodeset=\"/data/children/child\">\n        <input ref=\"/data/children/child/name\">\n          <label>What is the child's name?</label>\n        </input>\n        <group ref=\"/data/children/child/toys\">\n          <label>Child</label>\n          <repeat nodeset=\"/data/children/child/toys/toy\">\n            <input ref=\"/data/children/child/toys/toy/name\">\n              <label>What is the toy's name?</label>\n            </input>\n          </repeat>\n        </group>\n      </repeat>\n    </group>\n  </h:body>\n</h:html>",
          "bytes": 1687,
          "sha256": "6f85784ecc35394b395c22ae19da39df8bdc5348f2ac37cb06fd18d70964f768",
          "source": {
            "path": "test/data/xml.js",
            "blobSha": "e21ee6964421f30dbe32e93cf476735430358a1e",
            "fixture": "forms.doubleRepeat",
            "substitutions": []
          }
        }
      ],
      "submissions": [
        {
          "key": "double",
          "instanceId": "double",
          "formVersion": "1.0",
          "xml": "<data id=\"doubleRepeat\" version=\"1.0\">\n    <orx:meta><orx:instanceID>double</orx:instanceID></orx:meta>\n    <name>Vick</name>\n    <children>\n      <child>\n        <name>Alice</name>\n      </child>\n      <child>\n        <name>Bob</name>\n        <toys>\n          <toy><name>Twilight Sparkle</name></toy>\n          <toy><name>Pinkie Pie</name></toy>\n          <toy><name>Applejack</name></toy>\n          <toy><name>Spike</name></toy>\n        </toys>\n      </child>\n      <child>\n        <name>Chelsea</name>\n        <toys>\n          <toy><name>Rainbow Dash</name></toy>\n          <toy><name>Rarity</name></toy>\n          <toy><name>Fluttershy</name></toy>\n          <toy><name>Princess Luna</name></toy>\n        </toys>\n      </child>\n    </children>\n  </data>",
          "bytes": 757,
          "sha256": "874f75fe4dc481fea72f7d461f6f0fa0210697ce72148b4f2d7ff35d5f4a1bc0",
          "source": {
            "path": "test/data/xml.js",
            "blobSha": "e21ee6964421f30dbe32e93cf476735430358a1e",
            "fixture": "instances.doubleRepeat.double",
            "substitutions": []
          },
          "updates": [],
          "attachments": []
        }
      ]
    },
    {
      "key": "simple",
      "formId": "simple",
      "versions": [
        {
          "version": "",
          "versionRouteToken": "___",
          "xml": "<h:html xmlns=\"http://www.w3.org/2002/xforms\" xmlns:h=\"http://www.w3.org/1999/xhtml\" xmlns:xsd=\"http://www.w3.org/2001/XMLSchema\" xmlns:jr=\"http://openrosa.org/javarosa\">\n  <h:head>\n    <h:title>Simple</h:title>\n    <model>\n      <instance>\n        <data id=\"simple\">\n          <meta>\n            <instanceID/>\n          </meta>\n          <name/>\n          <age/>\n        </data>\n      </instance>\n\n      <bind nodeset=\"/data/meta/instanceID\" type=\"string\" readonly=\"true()\" calculate=\"concat('uuid:', uuid())\"/>\n      <bind nodeset=\"/data/name\" type=\"string\"/>\n      <bind nodeset=\"/data/age\" type=\"int\"/>\n    </model>\n\n  </h:head>\n  <h:body>\n    <input ref=\"/data/name\">\n      <label>What is your name?</label>\n    </input>\n    <input ref=\"/data/age\">\n      <label>What is your age?</label>\n    </input>\n  </h:body>\n</h:html>",
          "bytes": 827,
          "sha256": "93fdcefabfe5b6ea49f207e0c6fc8ba72ceb34828bff9c7929ef56eafd2d84cc",
          "source": {
            "path": "test/data/xml.js",
            "blobSha": "e21ee6964421f30dbe32e93cf476735430358a1e",
            "fixture": "forms.simple",
            "substitutions": []
          }
        },
        {
          "version": "updated",
          "versionRouteToken": "updated",
          "xml": "<h:html xmlns=\"http://www.w3.org/2002/xforms\" xmlns:h=\"http://www.w3.org/1999/xhtml\" xmlns:xsd=\"http://www.w3.org/2001/XMLSchema\" xmlns:jr=\"http://openrosa.org/javarosa\">\n  <h:head>\n    <h:title>Simple</h:title>\n    <model>\n      <instance>\n        <data id=\"simple\" version=\"updated\">\n          <meta>\n            <instanceID/>\n          </meta>\n          <name/>\n          <age/>\n        </data>\n      </instance>\n\n      <bind nodeset=\"/data/meta/instanceID\" type=\"string\" readonly=\"true()\" calculate=\"concat('uuid:', uuid())\"/>\n      <bind nodeset=\"/data/name\" type=\"string\"/>\n      <bind nodeset=\"/data/age\" type=\"int\"/>\n    </model>\n\n  </h:head>\n  <h:body>\n    <input ref=\"/data/name\">\n      <label>What is your name?</label>\n    </input>\n    <input ref=\"/data/age\">\n      <label>What is your age?</label>\n    </input>\n  </h:body>\n</h:html>",
          "bytes": 845,
          "sha256": "5563cff48739e852e2b1e46d6765515a297e79a1df65a45a868da11e3c1e25a2",
          "source": {
            "path": "test/data/xml.js",
            "blobSha": "e21ee6964421f30dbe32e93cf476735430358a1e",
            "fixture": "forms.simple",
            "substitutions": [
              {
                "find": "id=\"simple\"",
                "replace": "id=\"simple\" version=\"updated\"",
                "source": {
                  "path": "test/integration/api/submissions.js",
                  "blobSha": "0658f4ef3f0eb9917917bcd067fed4f093745d5e",
                  "test": "should list the original submitted form version per submission"
                }
              }
            ]
          }
        }
      ],
      "submissions": [
        {
          "key": "one",
          "instanceId": "one",
          "formVersion": "",
          "xml": "<data id=\"simple\"><meta><instanceID>one</instanceID></meta><name>Alice</name><age>30</age></data>",
          "bytes": 97,
          "sha256": "31e45f1db2252fcd49e9fba6c6820590b06be1e1bd61f3f345945f12d549d573",
          "source": {
            "path": "test/data/xml.js",
            "blobSha": "e21ee6964421f30dbe32e93cf476735430358a1e",
            "fixture": "instances.simple.one",
            "substitutions": []
          },
          "updates": [
            {
              "instanceId": "one2",
              "rootInstanceId": "one",
              "deprecatedId": "one",
              "formVersion": "updated",
              "xml": "<data id=\"simple\" version=\"updated\"><meta><deprecatedID>one</deprecatedID><instanceID>one2</instanceID></meta><name>Alice</name><age>30</age></data>",
              "bytes": 148,
              "sha256": "a25070e7df05e52b7de3225a5c42d902b252fa994aa553fd2007e8cee5fd9b07",
              "source": {
                "path": "test/data/xml.js",
                "blobSha": "e21ee6964421f30dbe32e93cf476735430358a1e",
                "fixture": "instances.simple.one",
                "substitutions": [
                  {
                    "find": "id=\"simple\"",
                    "replace": "id=\"simple\" version=\"updated\"",
                    "source": {
                      "path": "test/integration/api/submissions.js",
                      "blobSha": "0658f4ef3f0eb9917917bcd067fed4f093745d5e",
                      "test": "should list the original submitted form version per submission"
                    }
                  },
                  {
                    "find": "<instanceID>one",
                    "replace": "<deprecatedID>one</deprecatedID><instanceID>one2",
                    "source": {
                      "path": "test/integration/api/submissions.js",
                      "blobSha": "0658f4ef3f0eb9917917bcd067fed4f093745d5e",
                      "test": "should list the original submitted form version per submission"
                    }
                  }
                ]
              }
            }
          ],
          "attachments": []
        },
        {
          "key": "two",
          "instanceId": "two",
          "formVersion": "",
          "xml": "<data id=\"simple\"><meta><instanceID>two</instanceID></meta><name>Bob</name><age>34</age></data>",
          "bytes": 95,
          "sha256": "ae8e8d31de30030b211e2ac9aa6cf01b7bfe0c52f1f3f2bbe8c55558095733f2",
          "source": {
            "path": "test/data/xml.js",
            "blobSha": "e21ee6964421f30dbe32e93cf476735430358a1e",
            "fixture": "instances.simple.two",
            "substitutions": []
          },
          "updates": [],
          "attachments": []
        },
        {
          "key": "three",
          "instanceId": "three",
          "formVersion": "updated",
          "xml": "<data id=\"simple\" version=\"updated\"><meta><instanceID>three</instanceID></meta><name>Chelsea</name><age>38</age></data>",
          "bytes": 119,
          "sha256": "5286b95be888d27dc53e610b04df3b016f2f356137f046c3c4662f06c8078872",
          "source": {
            "path": "test/data/xml.js",
            "blobSha": "e21ee6964421f30dbe32e93cf476735430358a1e",
            "fixture": "instances.simple.three",
            "substitutions": [
              {
                "find": "id=\"simple\"",
                "replace": "id=\"simple\" version=\"updated\"",
                "source": {
                  "path": "test/integration/api/submissions.js",
                  "blobSha": "0658f4ef3f0eb9917917bcd067fed4f093745d5e",
                  "test": "should list the original submitted form version per submission"
                }
              }
            ]
          },
          "updates": [],
          "attachments": []
        }
      ]
    },
    {
      "key": "binaryType",
      "formId": "binaryType",
      "versions": [
        {
          "version": "",
          "versionRouteToken": "___",
          "xml": "<h:html xmlns=\"http://www.w3.org/2002/xforms\" xmlns:h=\"http://www.w3.org/1999/xhtml\" xmlns:xsd=\"http://www.w3.org/2001/XMLSchema\" xmlns:jr=\"http://openrosa.org/javarosa\">\n  <h:head>\n    <h:title>Submission </h:title>\n    <model>\n      <instance>\n        <data id=\"binaryType\">\n          <meta>\n            <instanceID/>\n          </meta>\n          <file1/>\n          <file2/>\n        </data>\n      </instance>\n\n      <bind nodeset=\"/data/meta/instanceID\" type=\"string\" readonly=\"true()\" calculate=\"concat('uuid:', uuid())\"/>\n      <bind nodeset=\"/data/file1\" type=\"binary\"/>\n      <bind nodeset=\"/data/file2\" type=\"binary\"/>\n    </model>\n\n  </h:head>\n  <h:body>\n    <upload ref=\"/data/file1\" mediatype=\"image/*\">\n      <label>Give me an image.</label>\n    </upload>\n    <upload ref=\"/data/file2\" mediatype=\"video/*\">\n      <label>Give me a video.</label>\n    </upload>\n  </h:body>\n</h:html>",
          "bytes": 890,
          "sha256": "a4128348086bf99dce3200bedf0e846e3ff355e0382705168b8b447d90f6a6f2",
          "source": {
            "path": "test/data/xml.js",
            "blobSha": "e21ee6964421f30dbe32e93cf476735430358a1e",
            "fixture": "forms.binaryType",
            "substitutions": []
          }
        }
      ],
      "submissions": [
        {
          "key": "both",
          "instanceId": "both",
          "formVersion": "",
          "xml": "<data id=\"binaryType\"><meta><instanceID>both</instanceID></meta><file1>my_file1.mp4</file1><file2>here_is_file2.jpg</file2></data>",
          "bytes": 130,
          "sha256": "699c6649a2684836708aaad24b829fa649530507445764fa0b57b0388115fb9e",
          "source": {
            "path": "test/data/xml.js",
            "blobSha": "e21ee6964421f30dbe32e93cf476735430358a1e",
            "fixture": "instances.binaryType.both",
            "substitutions": []
          },
          "updates": [],
          "attachments": [
            {
              "name": "my_file1.mp4",
              "contentType": "video/mp4",
              "base64": "dGhpcyBpcyB0ZXN0IGZpbGUgb25l",
              "bytes": 21,
              "sha256": "f46f660c541ed8ea962cf1968bffe2f99895fe7b38e0f45216e78cdebc264d1f",
              "source": {
                "path": "test/integration/api/submissions.js",
                "blobSha": "0658f4ef3f0eb9917917bcd067fed4f093745d5e",
                "literalUtf8": "this is test file one"
              },
              "note": "Exact released test payload bytes. This fixture is not a playable video or image."
            },
            {
              "name": "here_is_file2.jpg",
              "contentType": "image/jpeg",
              "base64": "dGhpcyBpcyB0ZXN0IGZpbGUgdHdv",
              "bytes": 21,
              "sha256": "010fff8ff39abed68d003d4ca77d3eb04f1a17ddb04905edbb788450c057f481",
              "source": {
                "path": "test/integration/api/submissions.js",
                "blobSha": "0658f4ef3f0eb9917917bcd067fed4f093745d5e",
                "literalUtf8": "this is test file two"
              },
              "note": "Exact released test payload bytes. This fixture is not a playable video or image."
            }
          ]
        }
      ]
    }
  ],
  "expectedTables": [
    {
      "formId": "doubleRepeat",
      "table": "Submissions",
      "rows": 1,
      "minimumPages": 1,
      "keys": [
        "__id"
      ]
    },
    {
      "formId": "doubleRepeat",
      "table": "Submissions.children.child",
      "rows": 3,
      "minimumPages": 2,
      "keys": [
        "__id"
      ],
      "parent": {
        "table": "Submissions",
        "foreignKey": "__Submissions-id",
        "key": "__id"
      }
    },
    {
      "formId": "doubleRepeat",
      "table": "Submissions.children.child.toys.toy",
      "rows": 8,
      "minimumPages": 4,
      "keys": [
        "__id"
      ],
      "parent": {
        "table": "Submissions.children.child",
        "foreignKey": "__Submissions-children-child-id",
        "key": "__id"
      }
    },
    {
      "formId": "simple",
      "table": "Submissions",
      "rows": 3,
      "minimumPages": 2,
      "keys": [
        "__id"
      ]
    },
    {
      "formId": "binaryType",
      "table": "Submissions",
      "rows": 1,
      "minimumPages": 1,
      "keys": [
        "__id"
      ]
    }
  ],
  "expectedSource": {
    "formCount": 3,
    "publishedFormVersionCount": 4,
    "currentSubmissionCount": 5,
    "submissionVersionCount": 6,
    "attachmentCount": 2,
    "attachmentBytes": 42,
    "simple": {
      "rootIds": [
        "one",
        "two",
        "three"
      ],
      "versionIds": [
        "one",
        "one2",
        "two",
        "three"
      ],
      "names": [
        "Alice",
        "Bob",
        "Chelsea"
      ],
      "ages": [
        30,
        34,
        38
      ],
      "ageMean": 34
    }
  },
  "dataset": {
    "formId": "simple",
    "table": "Submissions",
    "configuration": {
      "fields": [
        "__id",
        "name",
        "age"
      ],
      "name": "Released Central simple form source"
    }
  },
  "api": {
    "prefix": "/v1",
    "createForm": {
      "method": "POST",
      "path": "/projects/:projectId/forms",
      "query": {
        "publish": true
      },
      "contentType": "application/xml",
      "body": "exact versions[0].xml",
      "successStatus": 200
    },
    "createDraft": {
      "method": "POST",
      "path": "/projects/:projectId/forms/:xmlFormId/draft",
      "contentType": "application/xml",
      "body": "exact next version.xml",
      "successStatus": 200
    },
    "publishDraft": {
      "method": "POST",
      "path": "/projects/:projectId/forms/:xmlFormId/draft/publish",
      "body": null,
      "successStatus": 200
    },
    "createSubmission": {
      "method": "POST",
      "path": "/projects/:projectId/forms/:xmlFormId/submissions",
      "contentType": "application/xml",
      "body": "exact submission.xml",
      "successStatus": 200
    },
    "updateSubmission": {
      "method": "PUT",
      "path": "/projects/:projectId/forms/:xmlFormId/submissions/:rootInstanceId",
      "contentType": "application/xml",
      "body": "exact update.xml with new instanceID and current deprecatedID",
      "successStatus": 200
    },
    "uploadAttachment": {
      "method": "POST",
      "path": "/projects/:projectId/forms/:xmlFormId/submissions/:rootInstanceId/attachments/:name",
      "body": "exact decoded attachment.base64",
      "contentType": "attachment.contentType",
      "successStatus": 200
    },
    "submissionVersion": {
      "method": "GET",
      "path": "/projects/:projectId/forms/:xmlFormId/submissions/:rootInstanceId/versions/:instanceId.xml"
    },
    "submissionAttachmentVersion": {
      "method": "GET",
      "path": "/projects/:projectId/forms/:xmlFormId/submissions/:rootInstanceId/versions/:instanceId/attachments/:name"
    },
    "formVersion": {
      "method": "GET",
      "path": "/projects/:projectId/forms/:xmlFormId/versions/:versionRouteToken.xml"
    }
  },
  "notes": [
    "Upload into the original explicitly selected receiving project; no project ID, server origin, credential, customer form, or account is selected by this module.",
    "All original XML values are evaluated from released template literals and the exact released instance helper. No XML is prettified, normalized or namespace-repaired.",
    "The simple version='updated' and one→one2/deprecatedID substitutions exactly match the released submission-version integration example and are individually recorded above.",
    "The published metadata version of a form with no version attribute is the native blank version, represented by ___ only in its version route.",
    "Create/publish all selected form versions before their corresponding submissions; Central permits a submission for an older published form version. A receiving driver can preserve the original integration sequence when it prefers.",
    "On uncertain writes, read the same retained IDs/version/XML/media before proceeding. REST submission POST is not a generic idempotency endpoint.",
    "The expected counts describe these constant inputs, not an observed Central result. The original receiving operation must verify actual table pages, parent keys, form/submission versions and original media hashes.",
    "Attachment payloads are exact upstream test strings with the upstream media names/types. They validate byte retention and do not constitute real field images or videos."
  ]
});
