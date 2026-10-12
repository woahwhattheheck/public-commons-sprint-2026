# Original gRPC reflection protocols

These unmodified protocol files come from the official grpc/grpc-proto repository and retain their Apache-2.0 copyright and license notices. The complete upstream [LICENSE](LICENSE) is included.

| Protocol | Original file | Git blob |
| --- | --- | --- |
| v1 | https://github.com/grpc/grpc-proto/blob/master/grpc/reflection/v1/reflection.proto | `1a2ceedc3d2810d317cf8c7f1bada0852b2d603c` |
| v1alpha | https://github.com/grpc/grpc-proto/blob/master/grpc/reflection/v1alpha/reflection.proto | `e8384db373b22ba6674ba51ac01d89512828ca52` |

The runtime uses the pinned @grpc/grpc-js and @grpc/proto-loader packages for these wire contracts. It retains one bidirectional stream for a selected source acquisition, validates each original_request, and caches exact descriptor bytes omitted from later responses in that same stream. Automatic selection uses v1alpha after v1 reports UNIMPLEMENTED.

Official guide: https://grpc.io/docs/guides/reflection/
