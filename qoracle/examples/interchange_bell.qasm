OPENQASM 2.0;
include "qelib1.inc";
qreg control[1];
qreg target[1];
creg result[2];
h control[0];
cx control[0],target[0];
measure target[0] -> result[0];
measure control[0] -> result[1];
