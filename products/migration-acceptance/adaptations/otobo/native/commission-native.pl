#!/usr/bin/env perl
# Prepared by TokenJunkieLabs.
# Complete internal native-parser/emitter journey; never imports OTOBO.
use strict;
use warnings;
use utf8;
use FindBin ();
use File::Spec ();
use Getopt::Long qw(GetOptions);
use MIME::Base64 qw(decode_base64);
use JSON::PP ();
my $helper=File::Spec->catfile($FindBin::Bin,'otobo-native-handover.pl');
require $helper;
my ($examples,$out,$node);
$node='node';
GetOptions('examples=s'=>\$examples,'out-dir=s'=>\$out,'node=s'=>\$node) or die "Invalid arguments\n";
defined($examples)&&defined($out) or die "Use --examples /actual/examples --out-dir /actual/new-course\n";
-d $examples or die "Original examples directory unavailable\n";
-e $out and die "Output already exists; preserved\n";
mkdir($out,0700) or die "Cannot create new course directory\n";
my @sets=qw(source before after matchingAfter);
my %captures;
my @artifacts;
for my $set (@sets) {
    my $reference=read_json(File::Spec->catfile($examples,$set.'.json'));
    ($reference->{evidenceKind}//'') eq 'authored-reference' or die "This course accepts only the retained authored reference\n";
    my $dir=File::Spec->catdir($out,$set.'-originals');
    mkdir($dir,0700) or die "Cannot create original source directory\n";
    my (@files,@evidence);
    for my $f (@{$reference->{files}}) {
        my $bytes=unpack_item($f);
        my $path=File::Spec->catfile($dir,$f->{filename});
        write_new($path,$bytes);
        push @files,{id=>$f->{id},filename=>$f->{filename},family=>$f->{family},path=>$path};
    }
    for my $f (@{$reference->{evidenceFiles}}) {
        my $bytes=unpack_item($f);
        my $path=File::Spec->catfile($dir,$f->{filename});
        write_new($path,$bytes);
        push @evidence,{id=>$f->{id},filename=>$f->{filename},purpose=>$f->{purpose},path=>$path};
    }
    my $manifest={map {$_=>$reference->{$_}} qw(caseId side workspaceReference observedAt evidenceKind completeness externalContext)};
    $manifest->{files}=\@files;$manifest->{evidenceFiles}=\@evidence;
    $manifest->{workspaceReference}.=' / internal native-parser course';
    my $mp=File::Spec->catfile($out,$set.'.manifest.json');
    write_new($mp,canonical($manifest)."\n");
    my $cp=File::Spec->catfile($out,$set.'.capture.json');
    push @artifacts,{stage=>'capture',set=>$set,%{capture($manifest,$cp)}};
    $captures{$set}=read_json($cp);
}
my $original_plan=read_json(File::Spec->catfile($examples,'plan.json'));
my %plan=%$original_plan;
$plan{sourceCaptureId}=$captures{source}{captureId};
$plan{targetCaptureId}=$captures{before}{captureId};
$plan{expectedParser}=$captures{source}{environment}{parser};
$plan{planId}=seal(\%plan,'planId');
write_new(File::Spec->catfile($out,'reviewed.plan.json'),canonical(\%plan)."\n");
my $wrapper=File::Spec->catfile($FindBin::Bin,'prepare-handover.mjs');
my $handover=File::Spec->catdir($out,'reviewed-handover');
my @command=($wrapper,'--source',File::Spec->catfile($out,'source.capture.json'),
    '--target',File::Spec->catfile($out,'before.capture.json'),
    '--plan',File::Spec->catfile($out,'reviewed.plan.json'),'--out-dir',$handover,'--perl',$^X);
my $status=system {$node} $node,@command;
write_new(File::Spec->catfile($out,'reviewed-handover-process.json'),
    canonical({executable=>$node,arguments=>\@command,rawStatus=>$status,nativeImportsExecuted=>JSON::PP::false})."\n");
$status==0 or die "Original JS readiness/native emitter course did not complete; preserve the whole directory for recovery\n";
my $emission=read_json(File::Spec->catfile($handover,'emission','emission.json'));
push @artifacts,{stage=>'reviewed-emission',emissionId=>$emission->{emissionId},planId=>$plan{planId},files=>scalar(@{$emission->{outputs}})};

# Preserve a separate, clearly labeled scalar-format source and its native projection.
# These values exercise original numeric spelling, quoted strings, null, booleans and block text.
my $scalar=<<'YAML';
---
integer: 9007199254740993
quoted_integer: '9007199254740993'
exponent: 1e3
decimal: 0.10
empty: ''
null_value: ~
true_value: true
false_value: false
text: |-
  Original literal punctuation: !tag &anchor *alias
  Unicode: München
YAML
my $scalar_bytes=Encode::encode('UTF-8',$scalar);
my $native=native_load($scalar_bytes);
my $dump=native_dump($native);
my $reopened=native_load($dump);
same(tagged($native),tagged($reopened)) or die "Native scalar re-emission changed its typed projection\n";
write_new(File::Spec->catfile($out,'authored-scalar-format.yml'),$scalar_bytes);
write_new(File::Spec->catfile($out,'authored-scalar-format-emitted.yml'),$dump);
write_new(File::Spec->catfile($out,'authored-scalar-format.json'),canonical({evidenceKind=>'authored-reference',originalSha256=>Digest::SHA::sha256_hex($scalar_bytes),native=>tagged($native),parser=>environment()->{parser}})."\n");
my $outcome={schema=>'otobo.native-format-course.v1',preparedBy=>'TokenJunkieLabs',
    evidenceKind=>'authored-reference',nativeImportsExecuted=>JSON::PP::false,
    sourceCaptureId=>$captures{source}{captureId},beforeCaptureId=>$captures{before}{captureId},
    afterCaptureId=>$captures{after}{captureId},matchingAfterCaptureId=>$captures{matchingAfter}{captureId},
    planId=>$plan{planId},artifacts=>\@artifacts,
    boundary=>'The after and matchingAfter files remain authored comparisons from the original reference; they are not observed OTOBO import results.',
    next=>'Use the existing JS review/Migration Acceptance adapter with these native captures and reviewed.plan.json. Only a separate original operator can perform a real native import and independent target export.'};
write_new(File::Spec->catfile($out,'course-outcome.json'),canonical($outcome)."\n");
print canonical($outcome)."\n";
