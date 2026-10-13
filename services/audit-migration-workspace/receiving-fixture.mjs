import * as E from './engine.mjs';
// Complete explicitly authored receiving examples; no supplier or customer records.
export const receivingGenesis={"id":"audit-whole-authored-example","title":"Explicitly authored twelve-role audit migration course","createdAt":"2026-10-13T19:00:00Z"};
const originalRequests=[
  {
    "name": "importFile",
    "input": {
      "operationId": "course-001",
      "expectedRevision": 0,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "fileId": "evidence-original",
      "filename": "Evidence_Ω.bin",
      "mimeType": "application/octet-stream",
      "purpose": "Authored every-byte evidence example",
      "representation": "authored-example",
      "base64": "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0+P0BBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWltcXV5fYGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6e3x9fn+AgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6ChoqOkpaanqKmqq6ytrq+wsbKztLW2t7i5uru8vb6/wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t/g4eLj5OXm5+jp6uvs7e7v8PHy8/T19vf4+fr7/P3+/w=="
    }
  },
  {
    "name": "importFile",
    "input": {
      "operationId": "course-002",
      "expectedRevision": 1,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "fileId": "policy-original",
      "filename": "Permission_and_history.txt",
      "mimeType": "text/plain",
      "purpose": "Explicit authored receiving policy",
      "representation": "authored-example",
      "base64": "QXV0aG9yZWQgZGVjbGFyYXRpb24gb25seS4gUHJlc2VydmUgZ3JhbnQvZGVueSB0ZXh0OyBkbyBub3QgaW5mZXIgYXV0aG9yaXphdGlvbi4gRnVsbCBleGFtcGxlIGhpc3RvcnkgYW5kIGV2aWRlbmNlIGFyZSBkZWNsYXJlZC4="
    }
  },
  {
    "name": "importCsv",
    "input": {
      "operationId": "course-003",
      "expectedRevision": 2,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "filename": "universe.csv",
      "side": "source",
      "role": "universe",
      "text": "id,label\r\nU1,Shared name\r\nU2,Shared name\r\n",
      "purpose": "Authored complete receiving example",
      "representation": "authored-example"
    }
  },
  {
    "name": "saveMapping",
    "input": {
      "operationId": "course-004",
      "expectedRevision": 3,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "sourceId": "source-a2bd760f3e14fa693af722b1d5d8ed247f51873d",
      "namespace": "example",
      "keyColumns": [
        0
      ],
      "fields": {
        "label": {
          "column": 1
        }
      },
      "references": [],
      "note": "Authored explicit source mapping"
    }
  },
  {
    "name": "importCsv",
    "input": {
      "operationId": "course-005",
      "expectedRevision": 4,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "filename": "plans.csv",
      "side": "source",
      "role": "plans",
      "text": "id,label,ref0\r\nP1,Annual plan,U1\r\n",
      "purpose": "Authored complete receiving example",
      "representation": "authored-example"
    }
  },
  {
    "name": "saveMapping",
    "input": {
      "operationId": "course-006",
      "expectedRevision": 5,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "sourceId": "source-2d974ac2e1fa5bdd7131607d3e8b93f9d04d2648",
      "namespace": "example",
      "keyColumns": [
        0
      ],
      "fields": {
        "label": {
          "column": 1
        }
      },
      "references": [
        {
          "id": "ref0",
          "relation": "in-universe",
          "purpose": "other",
          "targetRole": "universe",
          "targetNamespace": "example",
          "key": [
            {
              "column": 2
            }
          ],
          "required": true
        }
      ],
      "note": "Authored explicit source mapping"
    }
  },
  {
    "name": "importCsv",
    "input": {
      "operationId": "course-007",
      "expectedRevision": 6,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "filename": "engagements.csv",
      "side": "source",
      "role": "engagements",
      "text": "id,label,ref0\r\nE1,Audit Ω,P1\r\n",
      "purpose": "Authored complete receiving example",
      "representation": "authored-example"
    }
  },
  {
    "name": "saveMapping",
    "input": {
      "operationId": "course-008",
      "expectedRevision": 7,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "sourceId": "source-e94fe318002a30408cbd8bad8a41726abf26a999",
      "namespace": "example",
      "keyColumns": [
        0
      ],
      "fields": {
        "label": {
          "column": 1
        }
      },
      "references": [
        {
          "id": "ref0",
          "relation": "in-plan",
          "purpose": "other",
          "targetRole": "plans",
          "targetNamespace": "example",
          "key": [
            {
              "column": 2
            }
          ],
          "required": true
        }
      ],
      "note": "Authored explicit source mapping"
    }
  },
  {
    "name": "importCsv",
    "input": {
      "operationId": "course-009",
      "expectedRevision": 8,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "filename": "controls.csv",
      "side": "source",
      "role": "controls",
      "text": "id,label,ref0\r\nC1,Control,E1\r\n",
      "purpose": "Authored complete receiving example",
      "representation": "authored-example"
    }
  },
  {
    "name": "saveMapping",
    "input": {
      "operationId": "course-010",
      "expectedRevision": 9,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "sourceId": "source-7a01b8ba44ea10ee3a7cdc133180a442c6bae44a",
      "namespace": "example",
      "keyColumns": [
        0
      ],
      "fields": {
        "label": {
          "column": 1
        }
      },
      "references": [
        {
          "id": "ref0",
          "relation": "in-engagement",
          "purpose": "other",
          "targetRole": "engagements",
          "targetNamespace": "example",
          "key": [
            {
              "column": 2
            }
          ],
          "required": true
        }
      ],
      "note": "Authored explicit source mapping"
    }
  },
  {
    "name": "importCsv",
    "input": {
      "operationId": "course-011",
      "expectedRevision": 10,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "filename": "tests.csv",
      "side": "source",
      "role": "tests",
      "text": "id,label,ref0\r\nT1,Test,C1\r\n",
      "purpose": "Authored complete receiving example",
      "representation": "authored-example"
    }
  },
  {
    "name": "saveMapping",
    "input": {
      "operationId": "course-012",
      "expectedRevision": 11,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "sourceId": "source-84d48bcf0665e8c14e832d5faf9713654fc0ff1a",
      "namespace": "example",
      "keyColumns": [
        0
      ],
      "fields": {
        "label": {
          "column": 1
        }
      },
      "references": [
        {
          "id": "ref0",
          "relation": "tests-control",
          "purpose": "other",
          "targetRole": "controls",
          "targetNamespace": "example",
          "key": [
            {
              "column": 2
            }
          ],
          "required": true
        }
      ],
      "note": "Authored explicit source mapping"
    }
  },
  {
    "name": "importCsv",
    "input": {
      "operationId": "course-013",
      "expectedRevision": 12,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "filename": "findings.csv",
      "side": "source",
      "role": "findings",
      "text": "id,label,ref0\r\nF1,Finding,T1\r\n",
      "purpose": "Authored complete receiving example",
      "representation": "authored-example"
    }
  },
  {
    "name": "saveMapping",
    "input": {
      "operationId": "course-014",
      "expectedRevision": 13,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "sourceId": "source-dc3dc265fc3822a8f72e7cf228da9cf23a78c6f7",
      "namespace": "example",
      "keyColumns": [
        0
      ],
      "fields": {
        "label": {
          "column": 1
        }
      },
      "references": [
        {
          "id": "ref0",
          "relation": "from-test",
          "purpose": "other",
          "targetRole": "tests",
          "targetNamespace": "example",
          "key": [
            {
              "column": 2
            }
          ],
          "required": true
        }
      ],
      "note": "Authored explicit source mapping"
    }
  },
  {
    "name": "importCsv",
    "input": {
      "operationId": "course-015",
      "expectedRevision": 14,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "filename": "actions.csv",
      "side": "source",
      "role": "actions",
      "text": "id,label,ref0\r\nA1,Action,F1\r\n",
      "purpose": "Authored complete receiving example",
      "representation": "authored-example"
    }
  },
  {
    "name": "saveMapping",
    "input": {
      "operationId": "course-016",
      "expectedRevision": 15,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "sourceId": "source-c6c9ee9cc68c4ae4aa6d9d706f2ca61434792fe8",
      "namespace": "example",
      "keyColumns": [
        0
      ],
      "fields": {
        "label": {
          "column": 1
        }
      },
      "references": [
        {
          "id": "ref0",
          "relation": "addresses-finding",
          "purpose": "other",
          "targetRole": "findings",
          "targetNamespace": "example",
          "key": [
            {
              "column": 2
            }
          ],
          "required": true
        }
      ],
      "note": "Authored explicit source mapping"
    }
  },
  {
    "name": "importCsv",
    "input": {
      "operationId": "course-017",
      "expectedRevision": 16,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "filename": "documents.csv",
      "side": "source",
      "role": "documents",
      "text": "id,label,ref0,file_id,sha256,byte_length,filename\r\nD1,Evidence,E1,evidence-original,40aff2e9d2d8922e47afd4648e6967497158785fbd1da870e7110266bf944880,256,Evidence_Ω.bin\r\n",
      "purpose": "Authored complete receiving example",
      "representation": "authored-example"
    }
  },
  {
    "name": "saveMapping",
    "input": {
      "operationId": "course-018",
      "expectedRevision": 17,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "sourceId": "source-ded8fb2ddce4c3c953a6a95e6fd8857037956b0e",
      "namespace": "example",
      "keyColumns": [
        0
      ],
      "fields": {
        "label": {
          "column": 1
        },
        "file_id": {
          "column": 3
        },
        "sha256": {
          "column": 4
        },
        "byte_length": {
          "column": 5
        },
        "filename": {
          "column": 6
        }
      },
      "references": [
        {
          "id": "ref0",
          "relation": "attached-to",
          "purpose": "attachment",
          "targetRole": "engagements",
          "targetNamespace": "example",
          "key": [
            {
              "column": 2
            }
          ],
          "required": true
        }
      ],
      "note": "Authored explicit source mapping"
    }
  },
  {
    "name": "importCsv",
    "input": {
      "operationId": "course-019",
      "expectedRevision": 18,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "filename": "principals.csv",
      "side": "source",
      "role": "principals",
      "text": "id,label\r\nPR1,Authored principal\r\n",
      "purpose": "Authored complete receiving example",
      "representation": "authored-example"
    }
  },
  {
    "name": "saveMapping",
    "input": {
      "operationId": "course-020",
      "expectedRevision": 19,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "sourceId": "source-721b69a172a2fb4c6e775afc5c03492e974b6e22",
      "namespace": "example",
      "keyColumns": [
        0
      ],
      "fields": {
        "label": {
          "column": 1
        }
      },
      "references": [],
      "note": "Authored explicit source mapping"
    }
  },
  {
    "name": "importCsv",
    "input": {
      "operationId": "course-021",
      "expectedRevision": 20,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "filename": "access_rules.csv",
      "side": "source",
      "role": "access_rules",
      "text": "id,label,ref0,ref1\r\nAR1,grant,PR1,E1\r\n",
      "purpose": "Authored complete receiving example",
      "representation": "authored-example"
    }
  },
  {
    "name": "saveMapping",
    "input": {
      "operationId": "course-022",
      "expectedRevision": 21,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "sourceId": "source-24862504d3549d877f41c81d465d9e09b9074d24",
      "namespace": "example",
      "keyColumns": [
        0
      ],
      "fields": {
        "label": {
          "column": 1
        }
      },
      "references": [
        {
          "id": "ref0",
          "relation": "principal",
          "purpose": "principal",
          "targetRole": "principals",
          "targetNamespace": "example",
          "key": [
            {
              "column": 2
            }
          ],
          "required": true
        },
        {
          "id": "ref1",
          "relation": "protects",
          "purpose": "protected",
          "targetRole": "engagements",
          "targetNamespace": "example",
          "key": [
            {
              "column": 3
            }
          ],
          "required": true
        }
      ],
      "note": "Authored explicit source mapping"
    }
  },
  {
    "name": "importCsv",
    "input": {
      "operationId": "course-023",
      "expectedRevision": 22,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "filename": "history.csv",
      "side": "source",
      "role": "history",
      "text": "id,label,ref0\r\nH1,Authored event,E1\r\n",
      "purpose": "Authored complete receiving example",
      "representation": "authored-example"
    }
  },
  {
    "name": "saveMapping",
    "input": {
      "operationId": "course-024",
      "expectedRevision": 23,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "sourceId": "source-cdf8181fe072b5a75ef75e4594b94f5ae08824d7",
      "namespace": "example",
      "keyColumns": [
        0
      ],
      "fields": {
        "label": {
          "column": 1
        }
      },
      "references": [
        {
          "id": "ref0",
          "relation": "subject",
          "purpose": "subject",
          "targetRole": "engagements",
          "targetNamespace": "example",
          "key": [
            {
              "column": 2
            }
          ],
          "required": true
        }
      ],
      "note": "Authored explicit source mapping"
    }
  },
  {
    "name": "importCsv",
    "input": {
      "operationId": "course-025",
      "expectedRevision": 24,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "filename": "relations.csv",
      "side": "source",
      "role": "relations",
      "text": "id,label,ref0,ref1\r\nR1,related,E1,U1\r\n",
      "purpose": "Authored complete receiving example",
      "representation": "authored-example"
    }
  },
  {
    "name": "saveMapping",
    "input": {
      "operationId": "course-026",
      "expectedRevision": 25,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "sourceId": "source-98e028e87750979da6c11edaf0164951d007d1f9",
      "namespace": "example",
      "keyColumns": [
        0
      ],
      "fields": {
        "label": {
          "column": 1
        }
      },
      "references": [
        {
          "id": "ref0",
          "relation": "from",
          "purpose": "from",
          "targetRole": "engagements",
          "targetNamespace": "example",
          "key": [
            {
              "column": 2
            }
          ],
          "required": true
        },
        {
          "id": "ref1",
          "relation": "to",
          "purpose": "to",
          "targetRole": "universe",
          "targetNamespace": "example",
          "key": [
            {
              "column": 3
            }
          ],
          "required": true
        }
      ],
      "note": "Authored explicit source mapping"
    }
  },
  {
    "name": "saveSelection",
    "input": {
      "operationId": "course-027",
      "expectedRevision": 26,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "mappingIds": [
        "mapping-bf2b0d4037812fd829395fa010aa85249291f906",
        "mapping-5b3b6bea3f7dae5bea60ce31d03ca7f0a8aad770",
        "mapping-9fa6574f28b3d1a065d58bd0ad68f95318ab8eb6",
        "mapping-37722885d9c358e2475ac1d14dc2e09e2f55e498",
        "mapping-c140968e5fcae789531e88acfc45e8010ee456d9",
        "mapping-42b745c3f582c7a1575e20357436c860724f3d08",
        "mapping-7fe31755c0d2511f8ec5c6252a70194b9d481715",
        "mapping-fbc261f8350850ad6e4d33f9bc34584d9ce4e923",
        "mapping-83107392c14652545efa1944dd29f6a70c711f7c",
        "mapping-af32db6d5d76e97aa4989579ab3c16a87f2fe31e",
        "mapping-97f75f418a24eddbc1b2adefca5a5abc8120ed86",
        "mapping-d1479ec229ec7485f2dfb7de4125ccf048d9707b"
      ],
      "fileIds": [
        "evidence-original",
        "policy-original"
      ],
      "roles": {
        "universe": {
          "status": "included",
          "reason": "Complete authored receiving population selected."
        },
        "plans": {
          "status": "included",
          "reason": "Complete authored receiving population selected."
        },
        "engagements": {
          "status": "included",
          "reason": "Complete authored receiving population selected."
        },
        "controls": {
          "status": "included",
          "reason": "Complete authored receiving population selected."
        },
        "tests": {
          "status": "included",
          "reason": "Complete authored receiving population selected."
        },
        "findings": {
          "status": "included",
          "reason": "Complete authored receiving population selected."
        },
        "actions": {
          "status": "included",
          "reason": "Complete authored receiving population selected."
        },
        "documents": {
          "status": "included",
          "reason": "Complete authored receiving population selected."
        },
        "principals": {
          "status": "included",
          "reason": "Complete authored receiving population selected."
        },
        "access_rules": {
          "status": "included",
          "reason": "Complete authored receiving population selected."
        },
        "history": {
          "status": "included",
          "reason": "Complete authored receiving population selected."
        },
        "relations": {
          "status": "included",
          "reason": "Complete authored receiving population selected."
        }
      },
      "declaredAcyclicRelations": [
        "in-universe",
        "in-plan",
        "in-engagement"
      ],
      "permissionBasis": {
        "status": "source-declared",
        "sourceFileIds": [
          "policy-original"
        ],
        "note": "Authored complete example, not actual supplier acceptance."
      },
      "historyBasis": {
        "status": "source-declared",
        "sourceFileIds": [
          "policy-original"
        ],
        "note": "Authored complete example, not actual supplier acceptance."
      },
      "evidenceBasis": {
        "status": "source-declared",
        "sourceFileIds": [
          "policy-original"
        ],
        "note": "Authored complete example, not actual supplier acceptance."
      },
      "note": "Whole twelve-role authored scope."
    }
  },
  {
    "name": "saveReview",
    "input": {
      "operationId": "course-028",
      "expectedRevision": 27,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "selectionId": "selection-d20f78fc1e8ee43e9a3bdcfb99be004ac5174009",
      "decision": "accepted",
      "note": "Reviewed structural authored example only."
    }
  },
  {
    "name": "importFile",
    "input": {
      "operationId": "course-029",
      "expectedRevision": 28,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "filename": "template-universe.csv",
      "mimeType": "text/csv",
      "purpose": "Authored destination template",
      "representation": "authored-example",
      "base64": "aWQsbGFiZWwNCg=="
    }
  },
  {
    "name": "importFile",
    "input": {
      "operationId": "course-030",
      "expectedRevision": 29,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "filename": "template-plans.csv",
      "mimeType": "text/csv",
      "purpose": "Authored destination template",
      "representation": "authored-example",
      "base64": "aWQsbGFiZWwscmVmMA0K"
    }
  },
  {
    "name": "importFile",
    "input": {
      "operationId": "course-031",
      "expectedRevision": 30,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "filename": "template-engagements.csv",
      "mimeType": "text/csv",
      "purpose": "Authored destination template",
      "representation": "authored-example",
      "base64": "aWQsbGFiZWwscmVmMA0K"
    }
  },
  {
    "name": "importFile",
    "input": {
      "operationId": "course-032",
      "expectedRevision": 31,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "filename": "template-controls.csv",
      "mimeType": "text/csv",
      "purpose": "Authored destination template",
      "representation": "authored-example",
      "base64": "aWQsbGFiZWwscmVmMA0K"
    }
  },
  {
    "name": "importFile",
    "input": {
      "operationId": "course-033",
      "expectedRevision": 32,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "filename": "template-tests.csv",
      "mimeType": "text/csv",
      "purpose": "Authored destination template",
      "representation": "authored-example",
      "base64": "aWQsbGFiZWwscmVmMA0K"
    }
  },
  {
    "name": "importFile",
    "input": {
      "operationId": "course-034",
      "expectedRevision": 33,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "filename": "template-findings.csv",
      "mimeType": "text/csv",
      "purpose": "Authored destination template",
      "representation": "authored-example",
      "base64": "aWQsbGFiZWwscmVmMA0K"
    }
  },
  {
    "name": "importFile",
    "input": {
      "operationId": "course-035",
      "expectedRevision": 34,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "filename": "template-actions.csv",
      "mimeType": "text/csv",
      "purpose": "Authored destination template",
      "representation": "authored-example",
      "base64": "aWQsbGFiZWwscmVmMA0K"
    }
  },
  {
    "name": "importFile",
    "input": {
      "operationId": "course-036",
      "expectedRevision": 35,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "filename": "template-documents.csv",
      "mimeType": "text/csv",
      "purpose": "Authored destination template",
      "representation": "authored-example",
      "base64": "aWQsbGFiZWwscmVmMCxmaWxlX2lkLHNoYTI1NixieXRlX2xlbmd0aCxmaWxlbmFtZQ0K"
    }
  },
  {
    "name": "importFile",
    "input": {
      "operationId": "course-037",
      "expectedRevision": 36,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "filename": "template-principals.csv",
      "mimeType": "text/csv",
      "purpose": "Authored destination template",
      "representation": "authored-example",
      "base64": "aWQsbGFiZWwNCg=="
    }
  },
  {
    "name": "importFile",
    "input": {
      "operationId": "course-038",
      "expectedRevision": 37,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "filename": "template-access_rules.csv",
      "mimeType": "text/csv",
      "purpose": "Authored destination template",
      "representation": "authored-example",
      "base64": "aWQsbGFiZWwscmVmMCxyZWYxDQo="
    }
  },
  {
    "name": "importFile",
    "input": {
      "operationId": "course-039",
      "expectedRevision": 38,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "filename": "template-history.csv",
      "mimeType": "text/csv",
      "purpose": "Authored destination template",
      "representation": "authored-example",
      "base64": "aWQsbGFiZWwscmVmMA0K"
    }
  },
  {
    "name": "importFile",
    "input": {
      "operationId": "course-040",
      "expectedRevision": 39,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "filename": "template-relations.csv",
      "mimeType": "text/csv",
      "purpose": "Authored destination template",
      "representation": "authored-example",
      "base64": "aWQsbGFiZWwscmVmMCxyZWYxDQo="
    }
  },
  {
    "name": "saveContract",
    "input": {
      "operationId": "course-041",
      "expectedRevision": 40,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "selectionId": "selection-d20f78fc1e8ee43e9a3bdcfb99be004ac5174009",
      "title": "Authored complete target contract",
      "authority": "authored-example",
      "sourceFileIds": [
        "file-cb0c697e08af3b764f42d360e41094b776a5ced5",
        "file-da9187602155e55e032406490c843983e0233243",
        "file-072aa99e1bae3905b02ba430156f8c362dd12e0a",
        "file-21c7c5ab6808e03142154a9b807c22f4c8d24771",
        "file-a5e52c1962a0aa7a43e653041cc11a4eb8ccd77b",
        "file-64fae4642acc554b918a66ca3dee04db51d9f2ca",
        "file-38de776f8e1d2e547823ef998176add45d1ac1c8",
        "file-3be862ee01daa057312b363525b533a854f9fbbb",
        "file-b73c23c4c59c05c3530d3ea105f01392a7b1629f",
        "file-b16f947bdd30fcd018bc28468cc219e98783e3dd",
        "file-9ac4134e26f1d3d20a5ee86d50efa5be49273fd1",
        "file-66cee39ca7f9e4096d567b154238a664573cc26e"
      ],
      "crosswalks": [],
      "tables": [
        {
          "id": "universe",
          "mappingId": "mapping-bf2b0d4037812fd829395fa010aa85249291f906",
          "templateFileId": "file-cb0c697e08af3b764f42d360e41094b776a5ced5",
          "keyColumns": [
            0
          ],
          "columns": {
            "0": {
              "column": 0
            },
            "1": {
              "column": 1
            }
          },
          "referenceBindings": []
        },
        {
          "id": "plans",
          "mappingId": "mapping-5b3b6bea3f7dae5bea60ce31d03ca7f0a8aad770",
          "templateFileId": "file-da9187602155e55e032406490c843983e0233243",
          "keyColumns": [
            0
          ],
          "columns": {
            "0": {
              "column": 0
            },
            "1": {
              "column": 1
            },
            "2": {
              "column": 2
            }
          },
          "referenceBindings": [
            {
              "referenceId": "ref0",
              "columns": [
                2
              ],
              "targetTableId": "universe"
            }
          ]
        },
        {
          "id": "engagements",
          "mappingId": "mapping-9fa6574f28b3d1a065d58bd0ad68f95318ab8eb6",
          "templateFileId": "file-072aa99e1bae3905b02ba430156f8c362dd12e0a",
          "keyColumns": [
            0
          ],
          "columns": {
            "0": {
              "column": 0
            },
            "1": {
              "column": 1
            },
            "2": {
              "column": 2
            }
          },
          "referenceBindings": [
            {
              "referenceId": "ref0",
              "columns": [
                2
              ],
              "targetTableId": "plans"
            }
          ]
        },
        {
          "id": "controls",
          "mappingId": "mapping-37722885d9c358e2475ac1d14dc2e09e2f55e498",
          "templateFileId": "file-21c7c5ab6808e03142154a9b807c22f4c8d24771",
          "keyColumns": [
            0
          ],
          "columns": {
            "0": {
              "column": 0
            },
            "1": {
              "column": 1
            },
            "2": {
              "column": 2
            }
          },
          "referenceBindings": [
            {
              "referenceId": "ref0",
              "columns": [
                2
              ],
              "targetTableId": "engagements"
            }
          ]
        },
        {
          "id": "tests",
          "mappingId": "mapping-c140968e5fcae789531e88acfc45e8010ee456d9",
          "templateFileId": "file-a5e52c1962a0aa7a43e653041cc11a4eb8ccd77b",
          "keyColumns": [
            0
          ],
          "columns": {
            "0": {
              "column": 0
            },
            "1": {
              "column": 1
            },
            "2": {
              "column": 2
            }
          },
          "referenceBindings": [
            {
              "referenceId": "ref0",
              "columns": [
                2
              ],
              "targetTableId": "controls"
            }
          ]
        },
        {
          "id": "findings",
          "mappingId": "mapping-42b745c3f582c7a1575e20357436c860724f3d08",
          "templateFileId": "file-64fae4642acc554b918a66ca3dee04db51d9f2ca",
          "keyColumns": [
            0
          ],
          "columns": {
            "0": {
              "column": 0
            },
            "1": {
              "column": 1
            },
            "2": {
              "column": 2
            }
          },
          "referenceBindings": [
            {
              "referenceId": "ref0",
              "columns": [
                2
              ],
              "targetTableId": "tests"
            }
          ]
        },
        {
          "id": "actions",
          "mappingId": "mapping-7fe31755c0d2511f8ec5c6252a70194b9d481715",
          "templateFileId": "file-38de776f8e1d2e547823ef998176add45d1ac1c8",
          "keyColumns": [
            0
          ],
          "columns": {
            "0": {
              "column": 0
            },
            "1": {
              "column": 1
            },
            "2": {
              "column": 2
            }
          },
          "referenceBindings": [
            {
              "referenceId": "ref0",
              "columns": [
                2
              ],
              "targetTableId": "findings"
            }
          ]
        },
        {
          "id": "documents",
          "mappingId": "mapping-fbc261f8350850ad6e4d33f9bc34584d9ce4e923",
          "templateFileId": "file-3be862ee01daa057312b363525b533a854f9fbbb",
          "keyColumns": [
            0
          ],
          "columns": {
            "0": {
              "column": 0
            },
            "1": {
              "column": 1
            },
            "2": {
              "column": 2
            },
            "3": {
              "column": 3
            },
            "4": {
              "column": 4
            },
            "5": {
              "column": 5
            },
            "6": {
              "column": 6
            }
          },
          "referenceBindings": [
            {
              "referenceId": "ref0",
              "columns": [
                2
              ],
              "targetTableId": "engagements"
            }
          ]
        },
        {
          "id": "principals",
          "mappingId": "mapping-83107392c14652545efa1944dd29f6a70c711f7c",
          "templateFileId": "file-b73c23c4c59c05c3530d3ea105f01392a7b1629f",
          "keyColumns": [
            0
          ],
          "columns": {
            "0": {
              "column": 0
            },
            "1": {
              "column": 1
            }
          },
          "referenceBindings": []
        },
        {
          "id": "access_rules",
          "mappingId": "mapping-af32db6d5d76e97aa4989579ab3c16a87f2fe31e",
          "templateFileId": "file-b16f947bdd30fcd018bc28468cc219e98783e3dd",
          "keyColumns": [
            0
          ],
          "columns": {
            "0": {
              "column": 0
            },
            "1": {
              "column": 1
            },
            "2": {
              "column": 2
            },
            "3": {
              "column": 3
            }
          },
          "referenceBindings": [
            {
              "referenceId": "ref0",
              "columns": [
                2
              ],
              "targetTableId": "principals"
            },
            {
              "referenceId": "ref1",
              "columns": [
                3
              ],
              "targetTableId": "engagements"
            }
          ]
        },
        {
          "id": "history",
          "mappingId": "mapping-97f75f418a24eddbc1b2adefca5a5abc8120ed86",
          "templateFileId": "file-9ac4134e26f1d3d20a5ee86d50efa5be49273fd1",
          "keyColumns": [
            0
          ],
          "columns": {
            "0": {
              "column": 0
            },
            "1": {
              "column": 1
            },
            "2": {
              "column": 2
            }
          },
          "referenceBindings": [
            {
              "referenceId": "ref0",
              "columns": [
                2
              ],
              "targetTableId": "engagements"
            }
          ]
        },
        {
          "id": "relations",
          "mappingId": "mapping-d1479ec229ec7485f2dfb7de4125ccf048d9707b",
          "templateFileId": "file-66cee39ca7f9e4096d567b154238a664573cc26e",
          "keyColumns": [
            0
          ],
          "columns": {
            "0": {
              "column": 0
            },
            "1": {
              "column": 1
            },
            "2": {
              "column": 2
            },
            "3": {
              "column": 3
            }
          },
          "referenceBindings": [
            {
              "referenceId": "ref0",
              "columns": [
                2
              ],
              "targetTableId": "engagements"
            },
            {
              "referenceId": "ref1",
              "columns": [
                3
              ],
              "targetTableId": "universe"
            }
          ]
        }
      ],
      "note": "Fictional receiving template, not IRIS native fields."
    }
  },
  {
    "name": "prepareTarget",
    "input": {
      "operationId": "course-042",
      "expectedRevision": 41,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "contractId": "contract-e6c770d26d0924fdf116c3e0e0d95fd21312c0bb",
      "reviewId": "review-2377ca58095091f026a5b69802bb24b9217bad65",
      "note": "Freeze original authored submission."
    }
  },
  {
    "name": "importFile",
    "input": {
      "operationId": "course-043",
      "expectedRevision": 42,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "filename": "returned-universe.csv",
      "mimeType": "text/csv",
      "purpose": "Authored actual returned file",
      "representation": "authored-example",
      "base64": "aWQsbGFiZWwNClUxLFNoYXJlZCBuYW1lDQpVMixTaGFyZWQgbmFtZQ0K"
    }
  },
  {
    "name": "importFile",
    "input": {
      "operationId": "course-044",
      "expectedRevision": 43,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "filename": "returned-plans.csv",
      "mimeType": "text/csv",
      "purpose": "Authored actual returned file",
      "representation": "authored-example",
      "base64": "aWQsbGFiZWwscmVmMA0KUDEsQW5udWFsIHBsYW4sVTENCg=="
    }
  },
  {
    "name": "importFile",
    "input": {
      "operationId": "course-045",
      "expectedRevision": 44,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "filename": "returned-engagements.csv",
      "mimeType": "text/csv",
      "purpose": "Authored actual returned file",
      "representation": "authored-example",
      "base64": "aWQsbGFiZWwscmVmMA0KRTEsQXVkaXQgzqksUDENCg=="
    }
  },
  {
    "name": "importFile",
    "input": {
      "operationId": "course-046",
      "expectedRevision": 45,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "filename": "returned-controls.csv",
      "mimeType": "text/csv",
      "purpose": "Authored actual returned file",
      "representation": "authored-example",
      "base64": "aWQsbGFiZWwscmVmMA0KQzEsQ29udHJvbCxFMQ0K"
    }
  },
  {
    "name": "importFile",
    "input": {
      "operationId": "course-047",
      "expectedRevision": 46,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "filename": "returned-tests.csv",
      "mimeType": "text/csv",
      "purpose": "Authored actual returned file",
      "representation": "authored-example",
      "base64": "aWQsbGFiZWwscmVmMA0KVDEsVGVzdCxDMQ0K"
    }
  },
  {
    "name": "importFile",
    "input": {
      "operationId": "course-048",
      "expectedRevision": 47,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "filename": "returned-findings.csv",
      "mimeType": "text/csv",
      "purpose": "Authored actual returned file",
      "representation": "authored-example",
      "base64": "aWQsbGFiZWwscmVmMA0KRjEsRmluZGluZyxUMQ0K"
    }
  },
  {
    "name": "importFile",
    "input": {
      "operationId": "course-049",
      "expectedRevision": 48,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "filename": "returned-actions.csv",
      "mimeType": "text/csv",
      "purpose": "Authored actual returned file",
      "representation": "authored-example",
      "base64": "aWQsbGFiZWwscmVmMA0KQTEsQWN0aW9uLEYxDQo="
    }
  },
  {
    "name": "importFile",
    "input": {
      "operationId": "course-050",
      "expectedRevision": 49,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "filename": "returned-documents.csv",
      "mimeType": "text/csv",
      "purpose": "Authored actual returned file",
      "representation": "authored-example",
      "base64": "aWQsbGFiZWwscmVmMCxmaWxlX2lkLHNoYTI1NixieXRlX2xlbmd0aCxmaWxlbmFtZQ0KRDEsRXZpZGVuY2UsRTEsZXZpZGVuY2Utb3JpZ2luYWwsNDBhZmYyZTlkMmQ4OTIyZTQ3YWZkNDY0OGU2OTY3NDk3MTU4Nzg1ZmJkMWRhODcwZTcxMTAyNjZiZjk0NDg4MCwyNTYsRXZpZGVuY2VfzqkuYmluDQo="
    }
  },
  {
    "name": "importFile",
    "input": {
      "operationId": "course-051",
      "expectedRevision": 50,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "filename": "returned-principals.csv",
      "mimeType": "text/csv",
      "purpose": "Authored actual returned file",
      "representation": "authored-example",
      "base64": "aWQsbGFiZWwNClBSMSxBdXRob3JlZCBwcmluY2lwYWwNCg=="
    }
  },
  {
    "name": "importFile",
    "input": {
      "operationId": "course-052",
      "expectedRevision": 51,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "filename": "returned-access_rules.csv",
      "mimeType": "text/csv",
      "purpose": "Authored actual returned file",
      "representation": "authored-example",
      "base64": "aWQsbGFiZWwscmVmMCxyZWYxDQpBUjEsZ3JhbnQsUFIxLEUxDQo="
    }
  },
  {
    "name": "importFile",
    "input": {
      "operationId": "course-053",
      "expectedRevision": 52,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "filename": "returned-history.csv",
      "mimeType": "text/csv",
      "purpose": "Authored actual returned file",
      "representation": "authored-example",
      "base64": "aWQsbGFiZWwscmVmMA0KSDEsQXV0aG9yZWQgZXZlbnQsRTENCg=="
    }
  },
  {
    "name": "importFile",
    "input": {
      "operationId": "course-054",
      "expectedRevision": 53,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "filename": "returned-relations.csv",
      "mimeType": "text/csv",
      "purpose": "Authored actual returned file",
      "representation": "authored-example",
      "base64": "aWQsbGFiZWwscmVmMCxyZWYxDQpSMSxyZWxhdGVkLEUxLFUxDQo="
    }
  },
  {
    "name": "recordReturn",
    "input": {
      "operationId": "course-055",
      "expectedRevision": 54,
      "at": "2026-10-13T19:00:00Z",
      "actor": "Receiving operator",
      "preparationId": "preparation-0429f190f3c8c7a1590fb2de4b5d167d01228bc0",
      "tables": [
        {
          "tableId": "universe",
          "fileId": "file-612bc8852e660a29c8b1d3f74d3085dceb9eb263",
          "columns": {
            "0": 0,
            "1": 1
          }
        },
        {
          "tableId": "plans",
          "fileId": "file-0c41836c786b5340cd0e1e7a08f4698c292dc3aa",
          "columns": {
            "0": 0,
            "1": 1,
            "2": 2
          }
        },
        {
          "tableId": "engagements",
          "fileId": "file-7bed7004ecd1ebe567c815ff5b54fe9640daca0e",
          "columns": {
            "0": 0,
            "1": 1,
            "2": 2
          }
        },
        {
          "tableId": "controls",
          "fileId": "file-60f72abba74ddc2d166608276723a32d1869e564",
          "columns": {
            "0": 0,
            "1": 1,
            "2": 2
          }
        },
        {
          "tableId": "tests",
          "fileId": "file-d9d459eb43f6c285e3519b45351602525a2e806b",
          "columns": {
            "0": 0,
            "1": 1,
            "2": 2
          }
        },
        {
          "tableId": "findings",
          "fileId": "file-738ceb85a527b626145f37609db4921434f3ceb1",
          "columns": {
            "0": 0,
            "1": 1,
            "2": 2
          }
        },
        {
          "tableId": "actions",
          "fileId": "file-ddcfa4a7fe7cebd25e98e31df3c5dfe0bf42a72a",
          "columns": {
            "0": 0,
            "1": 1,
            "2": 2
          }
        },
        {
          "tableId": "documents",
          "fileId": "file-5a3828f482155daf199a1c6b3a643cdbe9d6ef1a",
          "columns": {
            "0": 0,
            "1": 1,
            "2": 2,
            "3": 3,
            "4": 4,
            "5": 5,
            "6": 6
          }
        },
        {
          "tableId": "principals",
          "fileId": "file-835ca0b67b3bfa886bcb9aa48b1d9059ef9ca83d",
          "columns": {
            "0": 0,
            "1": 1
          }
        },
        {
          "tableId": "access_rules",
          "fileId": "file-65a72f91eec7b576d0c738ed16a826a304072e10",
          "columns": {
            "0": 0,
            "1": 1,
            "2": 2,
            "3": 3
          }
        },
        {
          "tableId": "history",
          "fileId": "file-5f0a647e002efe089ef79cf11d12aa13fe039233",
          "columns": {
            "0": 0,
            "1": 1,
            "2": 2
          }
        },
        {
          "tableId": "relations",
          "fileId": "file-bb93d2b16af07cb44557a413d4e87a428c9f2d1d",
          "columns": {
            "0": 0,
            "1": 1,
            "2": 2,
            "3": 3
          }
        }
      ],
      "submissionReference": "AUTHORED-RETURN-1",
      "note": "Complete authored returned-data comparison."
    }
  }
];
export function receivingRequests(){return structuredClone(originalRequests);}
export function buildReceivingFixture(){let workspace=E.createWorkspace(receivingGenesis);const events=[];for(const event of receivingRequests()){const result=E[event.name](workspace,event.input);workspace=result.workspace;events.push({...event,receipt:result.receipt});}return {workspace,events,selectionId:"selection-d20f78fc1e8ee43e9a3bdcfb99be004ac5174009",contractId:"contract-e6c770d26d0924fdf116c3e0e0d95fd21312c0bb",preparationId:"preparation-0429f190f3c8c7a1590fb2de4b5d167d01228bc0",returnId:"return-69a374a26376eb0bd69814147d3d838b81c7177b",mappingByRole:{"universe":"mapping-bf2b0d4037812fd829395fa010aa85249291f906","plans":"mapping-5b3b6bea3f7dae5bea60ce31d03ca7f0a8aad770","engagements":"mapping-9fa6574f28b3d1a065d58bd0ad68f95318ab8eb6","controls":"mapping-37722885d9c358e2475ac1d14dc2e09e2f55e498","tests":"mapping-c140968e5fcae789531e88acfc45e8010ee456d9","findings":"mapping-42b745c3f582c7a1575e20357436c860724f3d08","actions":"mapping-7fe31755c0d2511f8ec5c6252a70194b9d481715","documents":"mapping-fbc261f8350850ad6e4d33f9bc34584d9ce4e923","principals":"mapping-83107392c14652545efa1944dd29f6a70c711f7c","access_rules":"mapping-af32db6d5d76e97aa4989579ab3c16a87f2fe31e","history":"mapping-97f75f418a24eddbc1b2adefca5a5abc8120ed86","relations":"mapping-d1479ec229ec7485f2dfb7de4125ccf048d9707b"}};}
