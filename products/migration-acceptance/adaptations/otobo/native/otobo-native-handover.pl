#!/usr/bin/env perl
# Prepared by TokenJunkieLabs. Original OTOBO writers remain authoritative.
# This helper captures and derives files; it never imports configuration.
use strict;
use warnings;
use utf8;
use JSON::PP ();
use MIME::Base64 qw(encode_base64 decode_base64);
use Digest::SHA qw(sha256_hex);
use Encode qw(encode decode FB_CROAK LEAVE_SRC);
use Scalar::Util qw(blessed refaddr);
use B ();
use Getopt::Long qw(GetOptionsFromArray);
use File::Spec ();
use File::Basename qw(dirname basename);
use Fcntl qw(O_WRONLY O_CREAT O_EXCL);
use Cwd qw(abs_path);
use POSIX qw(strftime);
my $OTOBO_ROOT;
use YAML::XS ();
use version ();

my @FAMILIES = qw(Groups Roles Types Templates Services SLAs Queues QueueTemplates RoleGroups GenericAgents);
my %FAMILY = map { $_ => 1 } @FAMILIES;
my $RAW_LIMIT = 40_000_000;
my $JSON_LIMIT = 256_000_000;
my $NODE_LIMIT = 250_000;
my $JSON = JSON::PP->new->utf8->allow_nonref->allow_blessed(0)->convert_blessed(0);
my $PROFILE = {
    id => 'tjlabs.otobo.strict-native-yaml.v1',
    interface => 'YAML::XS::Load/Dump functional',
    documents => 1, duplicateKeys => 'reject',
    tagsAnchorsAliases => 'reject outside quoted and block scalars',
    mapKeys => 'native strings; no normalization',
    ForbidDuplicateKeys => JSON::PP::true,
    LoadBlessed => JSON::PP::false, LoadCode => JSON::PP::false,
    UseCode => JSON::PP::false, DumpCode => JSON::PP::false,
    QuoteNumericStrings => JSON::PP::true, Boolean => 'JSON::PP', Indent => 2,
    scalarAuthority => 'original YAML parsed by installed native parser; tagged value is explanatory',
};
my %OBSERVED;
for my $key (qw(ForbidDuplicateKeys LoadBlessed LoadCode UseCode DumpCode QuoteNumericStrings Boolean Indent)) {
    no strict 'refs';
    my $value = ${'YAML::XS::'.$key};
    $OBSERVED{$key} = defined($value) ? "$value" : undef;
}

sub fail { die "OTOBO_HANDOVER: $_[0]\n"; }
sub hash_ref { ref($_[0]) eq 'HASH' or fail("$_[1] must be an object"); return $_[0]; }
sub array_ref { ref($_[0]) eq 'ARRAY' or fail("$_[1] must be an array"); return $_[0]; }
sub text {
    my ($v,$label,$max,$empty) = @_;
    defined($v) && !ref($v) or fail("$label must be text");
    # JSON metadata must really be a string, not an accidentally accepted number.
    my $flags = B::svref_2object(\$v)->FLAGS;
    ($flags & B::SVf_POK()) or fail("$label must be a JSON string");
    length($v) <= ($max // 4096) && ($empty || length($v)) && $v !~ /\x00/
        or fail("$label has invalid length or a NUL");
    return $v;
}
sub identifier { my $s=text($_[0],$_[1],160,0); $s =~ /\A[A-Za-z0-9_-]+\z/ or fail("$_[1] is not a safe identifier"); return $s; }
sub boolean { JSON::PP::is_bool($_[0]) or fail("$_[1] must be boolean"); return $_[0]; }
sub integer {
    my ($v,$label,$max)=@_;
    defined($v) && !ref($v) && "$v" =~ /\A(?:0|[1-9][0-9]*)\z/ && $v <= $max or fail("$label must be a bounded nonnegative integer");
    return 0+$v;
}
sub instant {
    my $s=text($_[0],$_[1],64,0);
    $s =~ /\A\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)\z/
        or fail("$_[1] must be an explicitly zoned ISO timestamp");
    return $s;
}
sub utf16_sort { return sort { encode('UTF-16BE',$a) cmp encode('UTF-16BE',$b) } @_; }
sub canonical {
    my ($v)=@_;
    return 'null' unless defined($v);
    return $v ? 'true' : 'false' if JSON::PP::is_bool($v);
    if (ref($v) eq 'ARRAY') { return '['.join(',',map {canonical($_)} @$v).']'; }
    if (ref($v) eq 'HASH') {
        return '{'.join(',',map {$JSON->encode($_).':'.canonical($v->{$_})} utf16_sort(keys %$v)).'}';
    }
    ref($v) and fail('Non-JSON reference in canonical value');
    return $JSON->encode($v);
}
sub seal {
    my ($value,$field)=@_;
    my %copy=%$value; delete $copy{$field};
    return sha256_hex(canonical(\%copy));
}
sub same { canonical($_[0]) eq canonical($_[1]); }
sub read_bytes {
    my ($path,$limit)=@_;
    -f $path && !-l $path or fail("Input must be a regular non-symlink file: $path");
    my $size=-s $path;
    $size <= $limit or fail("Input exceeds $limit bytes: $path");
    open my $fh,'<:raw',$path or fail("Cannot open input $path");
    local $/; my $bytes=<$fh>; close $fh or fail("Cannot close input $path");
    defined($bytes) && length($bytes) <= $limit or fail('Input changed beyond its size bound');
    return $bytes;
}
sub read_json {
    my ($path)=@_;
    my $bytes=read_bytes($path,$JSON_LIMIT);
    my $parse_bytes=$bytes;
    $parse_bytes =~ s/\A\xEF\xBB\xBF//;
    my $v=eval {$JSON->decode($parse_bytes)};
    $@ and fail("Invalid JSON in $path");
    hash_ref($v,'JSON document');
    return $v;
}
sub write_new {
    my ($path,$bytes)=@_;
    sysopen my $fh,$path,O_WRONLY|O_CREAT|O_EXCL,0600 or fail("Output already exists or cannot be created: $path");
    binmode($fh,':raw');
    print {$fh} $bytes or fail("Cannot write $path");
    close $fh or fail("Cannot close $path");
}
sub filename {
    my $s=text($_[0],$_[1],240,0);
    $s ne '.' && $s ne '..' && $s !~ m{[/\\]} or fail("$_[1] must be a single filename");
    return $s;
}
sub raw_item {
    my ($row,$bytes)=@_;
    my %v=(id=>identifier($row->{id},'file id'),filename=>filename($row->{filename},'filename'),
        body_base64=>encode_base64($bytes,''),bytes=>length($bytes),sha256=>sha256_hex($bytes));
    return \%v;
}
sub unpack_item {
    my ($row)=@_;
    hash_ref($row,'retained file'); identifier($row->{id},'file id'); filename($row->{filename},'filename');
    my $b=text($row->{body_base64},'base64',$JSON_LIMIT,1);
    length($b)%4==0 && $b =~ /\A[A-Za-z0-9+\/]*={0,2}\z/ or fail('Noncanonical Base64 alphabet');
    my $bytes=decode_base64($b);
    encode_base64($bytes,'') eq $b or fail('Noncanonical Base64 padding bits');
    length($bytes) <= $RAW_LIMIT && length($bytes)==integer($row->{bytes},'file bytes',$RAW_LIMIT)
        or fail('Retained file length mismatch');
    sha256_hex($bytes) eq text($row->{sha256},'file sha256',64,0) or fail('Retained file SHA mismatch');
    return $bytes;
}
sub native_profile (&) {
    my ($callback)=@_;
    local $YAML::XS::ForbidDuplicateKeys=1;
    local $YAML::XS::LoadBlessed=0;
    local $YAML::XS::LoadCode=0;
    local $YAML::XS::UseCode=0;
    local $YAML::XS::DumpCode=0;
    local $YAML::XS::QuoteNumericStrings=1;
    local $YAML::XS::Boolean='JSON::PP';
    local $YAML::XS::Indent=2;
    return $callback->();
}
sub native_dump { my ($value)=@_; return native_profile { YAML::XS::Dump($value) }; }
sub lexical_admission {
    my ($bytes)=@_;
    my $s=eval {decode('UTF-8',$bytes,FB_CROAK|LEAVE_SRC)};
    $@ and fail('YAML must be valid UTF-8');
    $s =~ s/\A\x{FEFF}//;
    $s !~ /\x00/ or fail('YAML contains a NUL');
    my ($quote,$escaped,$block,$block_indent)=('',0,0,0);
    my $line_number=0;
    for my $line (split /\r\n|\n|\r/,$s,-1) {
        $line_number++;
        my ($indent)=$line =~ /\A( *)/;
        if ($block) {
            next if $line =~ /\A\s*\z/ || length($indent)>$block_indent;
            $block=0;
        }
        if (!$quote && $line =~ /\A%/) { fail("YAML directives are outside this strict admission profile (line $line_number)"); }
        my $masked='';
        for (my $i=0;$i<length($line);$i++) {
            my $c=substr($line,$i,1);
            if ($quote eq "'") {
                if ($c eq "'") {
                    if (substr($line,$i+1,1) eq "'") {$i++;} else {$quote='';}
                }
                $masked.=' '; next;
            }
            if ($quote eq '"') {
                if ($escaped) {$escaped=0;}
                elsif ($c eq '\\') {$escaped=1;}
                elsif ($c eq '"') {$quote='';}
                $masked.=' '; next;
            }
            if ($c eq '#' && ($i==0 || substr($line,$i-1,1)=~/\s/)) {last;}
            # Only node-start quotes begin a quoted scalar. Apostrophes inside plain names remain plain.
            my $start = $i==0 || substr($line,$i-1,1)=~/[\s\[\]{},:?]/;
            if (($c eq "'" || $c eq '"') && $start) {$quote=$c;$masked.=' ';next;}
            if ($start && $c =~ /[!&*]/) {fail("Explicit tags, anchors and aliases require separate native review (line $line_number)");}
            $masked.=$c;
        }
        # Block-scalar content is literal, including punctuation that resembles tags.
        if (!$quote && $masked =~ /(?:\A|:\s+|-\s+|[,{]\s*)[|>](?:[1-9][+-]?|[+-][1-9]?|)\s*\z/) {
            $block=1; $block_indent=length($indent);
        }
        # A backslash at the end of a double-quoted line escapes its physical break, not the next character.
        $escaped=0;
    }
}
sub native_load {
    my ($bytes)=@_;
    length($bytes)<=$RAW_LIMIT or fail('YAML raw limit exceeded');
    lexical_admission($bytes);
    my @docs=eval {native_profile { YAML::XS::Load($bytes) }};
    $@ and fail('Native YAML parse rejected input (original bytes remain unchanged)');
    @docs==1 or fail('Exactly one YAML document is required; the original OTOBO last-document behavior is not admitted');
    return $docs[0];
}
sub tagged {
    my ($v,$depth,$seen,$count)=@_;
    $depth//=0; $seen//={}; my $local_count=0; $count//=\$local_count;
    $depth<=64 && ++$$count<=$NODE_LIMIT or fail('Native tree exceeds depth/node bound');
    if (!defined($v)) {return {kind=>'null',value=>undef,yamlToken=>decode('UTF-8',native_dump(undef),FB_CROAK)};}
    if (JSON::PP::is_bool($v)) {return {kind=>'boolean',value=>($v?'true':'false'),yamlToken=>decode('UTF-8',native_dump($v),FB_CROAK)};}
    if (ref($v)) {
        blessed($v) and fail('Blessed native values are not admitted');
        my $addr=refaddr($v); $seen->{$addr}++ and fail('Shared/recursive native structures are not admitted');
        my $result;
        if (ref($v) eq 'ARRAY') {$result={kind=>'array',value=>[map {tagged($_,$depth+1,$seen,$count)} @$v]};}
        elsif (ref($v) eq 'HASH') {
            my %children;
            for my $key (keys %$v) {$key !~ /\x00/ or fail('NUL map key'); $children{$key}=tagged($v->{$key},$depth+1,$seen,$count);}
            $result={kind=>'map',value=>\%children};
        }
        else {fail('Unsupported native reference');}
        delete $seen->{$addr}; return $result;
    }
    my $flags=B::svref_2object(\$v)->FLAGS;
    my $kind=($flags & B::SVf_NOK()) ? 'float' : ($flags & B::SVf_IOK()) ? 'integer' : 'string';
    # Dump before stringification: querying a numerical scalar must not turn it into a quoted string.
    my $token=decode('UTF-8',native_dump($v),FB_CROAK);
    my $value=join('', $v);
    $kind='float' if $kind eq 'integer' && $value !~ /\A[+-]?[0-9]+\z/;
    return {kind=>$kind,value=>$value,yamlToken=>$token};
}
sub service_identity {
    my ($name,$v)=@_;
    hash_ref($v,'Service value');
    defined($v->{NameShort}) && !ref($v->{NameShort}) && length("$v->{NameShort}") or fail('Service NameShort must be an original nonempty scalar');
    !ref($v->{Parent}) or fail('Service Parent must be scalar or null');
    my $parent=defined($v->{Parent})?"$v->{Parent}":'';
    my $full=(length($parent)?$parent.'::':'').$v->{NameShort};
    $full eq $name or fail('Native Service Parent/NameShort changes its original identity');
}
sub parse_family {
    my ($bytes,$family)=@_;
    $FAMILY{$family} or fail('Unknown native family');
    my $root=native_load($bytes);
    hash_ref($root,'native document');
    keys(%$root)==1 && exists($root->{$family}) or fail("Expected only the $family root");
    my $objects=hash_ref($root->{$family},'native family');
    my @entries;
    for my $name (utf16_sort(keys %$objects)) {
        length($name) && length($name)<=4096 && $name !~ /\x00/ or fail('Invalid native object name');
        service_identity($name,$objects->{$name}) if $family eq 'Services';
        push @entries,{name=>$name,value=>tagged($objects->{$name})};
    }
    return ($root,\@entries);
}
sub file_fingerprint {
    my ($path)=@_;
    return undef unless defined($path) && -f $path;
    my $b=read_bytes($path,64_000_000);
    return {bytes=>length($b),sha256=>sha256_hex($b)};
}
sub installation_identity {
    return undef unless defined $OTOBO_ROOT;
    my $release=read_bytes(File::Spec->catfile($OTOBO_ROOT,'RELEASE'),10000);
    my @paths=('Kernel/System/YAML.pm','Kernel/System/Console/Command/Admin/ImportExport/ImportStandardObject.pm',
      map {'Kernel/System/'.$_.'.pm'} qw(Group Type StandardTemplate Service SLA Queue GenericAgent Valid Lock Priority State User Salutation Signature SystemAddress));
    my %sources;
    for my $path (@paths) {
        my $full=File::Spec->catfile($OTOBO_ROOT,split m{/},$path);
        -f $full or fail("Required installed native source absent: $path");
        $sources{$path}=file_fingerprint($full);
    }
    return {releaseText=>decode('UTF-8',$release,FB_CROAK|LEAVE_SRC),
        releaseSha256=>sha256_hex($release),sourceFiles=>\%sources};
}
sub environment {
    version->parse($YAML::XS::VERSION)>=version->parse('0.84')
        or fail('YAML::XS >= 0.84 is required for duplicate-key rejection; original OTOBO minimum alone is insufficient');
    my %modules;
    for my $module (qw(YAML/XS.pm YAML/XS/LibYAML.pm JSON/PP.pm Kernel/System/YAML.pm)) {
        $modules{$module}=file_fingerprint($INC{$module}) if $INC{$module};
    }
    my @native;
    {no warnings 'once'; for my $path (@DynaLoader::dl_shared_objects) {
        push @native,{filename=>basename($path),%{file_fingerprint($path)}} if $path =~ m{(?:YAML|LibYAML)};
    }}
    if (defined $OTOBO_ROOT) {
        $modules{'Kernel/System/YAML.pm'}=file_fingerprint(File::Spec->catfile($OTOBO_ROOT,'Kernel','System','YAML.pm'));
    }
    my $parser={
        name=>'YAML::XS',version=>"$YAML::XS::VERSION",perl=>"$^V",
        interface=>'functional',profile=>$PROFILE,modules=>\%modules,nativeLibraries=>\@native,
    };
    return {parser=>$parser,otobo=>installation_identity(),observedDefaults=>\%OBSERVED,
        observedDefaultsScope=>'YAML::XS globals at helper startup; OTOBO YAML wrapper sets none itself',
        helper=>file_fingerprint(abs_path($0)),
        rawSourceRule=>'Original UTF-8 YAML bytes remain complete; yamlToken is a native re-emission, not a claimed lexical span'};
}
sub context_check {
    my ($context,$evidence)=@_; hash_ref($context,'externalContext');
    my $check=sub {
        my ($entry,$label)=@_; hash_ref($entry,$label);
        my $ids=array_ref($entry->{evidenceFileIds},"$label evidenceFileIds");
        @$ids or fail("$label requires original evidence");
        my %seen; for my $id (@$ids) {identifier($id,'evidence id'); $evidence->{$id} && !$seen{$id}++ or fail("$label has missing/duplicate evidence");}
    };
    if (exists $context->{lookupSets}) {
        for my $key (keys %{hash_ref($context->{lookupSets},'lookupSets')}) {
            my $v=$context->{lookupSets}{$key};$check->($v,"lookup $key");
            my %seen;for my $name (@{array_ref($v->{values},'lookup values')}) {text($name,'lookup name',4096,0);!$seen{$name}++ or fail('Duplicate lookup name');}
        }
    }
    if (exists $context->{permissionTypes}) {
        my $v=$context->{permissionTypes};$check->($v,'permissionTypes');
        my %seen;for my $name (@{array_ref($v->{values},'permission values')}) {text($name,'permission',128,0);!$seen{$name}++ or fail('Duplicate permission');}
    }
    if (exists $context->{maxQueueLevel}) {$check->($context->{maxQueueLevel},'maxQueueLevel');integer($context->{maxQueueLevel}{value},'maxQueueLevel',1000);}
    if (exists $context->{sharedObjects}) {
        my $shared=hash_ref($context->{sharedObjects},'sharedObjects');
        for my $kind (keys %$shared) {
            $kind =~ /\A(?:Salutation|Signature|SystemAddress)\z/ or fail('Unknown shared-object family');
            my $v=$shared->{$kind};$check->($v,'shared '.$kind);boolean($v->{complete},'shared completeness');
            my %names;
            for my $e (@{array_ref($v->{entries},'shared entries')}) {
                hash_ref($e,'shared entry');my $name=text($e->{name},'shared name',4096,0);
                !$names{$name}++ or fail('Duplicate shared object identity');
                my $node=hash_ref($e->{value},'shared tagged tree');
                ($node->{kind}//'') eq 'map' or fail('Shared object must retain a tagged map');
                my $fields=hash_ref($node->{value},'shared tagged fields');
                hash_ref($fields->{Name},'shared native Name');
                ($fields->{Name}{kind}//'') eq 'string' && ($fields->{Name}{value}//'') eq $name or fail('Shared native name differs');
            }
        }
    }
    return $context;
}
sub capture_metadata {
    my ($c)=@_;
    identifier($c->{caseId},'caseId');text($c->{workspaceReference},'workspaceReference',4096,0);instant($c->{observedAt},'observedAt');
    ($c->{side}//'') =~ /\A(?:source|target)\z/ or fail('Capture side must be source or target');
    ($c->{evidenceKind}//'') =~ /\A(?:provider-export|authored-reference)\z/ or fail('Invalid evidenceKind');
    my $completeness=hash_ref($c->{completeness},'completeness');
    keys(%$completeness)==@FAMILIES or fail('Completeness must explicitly declare all ten families');
    for my $f (@FAMILIES) {boolean($completeness->{$f},"completeness.$f");}
}
sub capture {
    my ($manifest,$out)=@_; capture_metadata($manifest);
    $manifest->{evidenceKind} ne 'provider-export' || defined($OTOBO_ROOT) or fail('A provider export capture requires --otobo-root for installed native source/version evidence');
    my (%ids,%names,%family_files,@files,@evidence);
    my $total=0;
    for my $row (@{array_ref($manifest->{files},'manifest files')}) {
        hash_ref($row,'manifest file'); identifier($row->{id},'file id'); !$ids{$row->{id}}++ or fail('Duplicate file id');
        my $bytes=read_bytes(text($row->{path},'input path',8192,0),$RAW_LIMIT);
        ($total+=length($bytes))<=160_000_000 or fail('Total original input exceeds 160 MB');
        my $family=text($row->{family},'family',64,0);
        my (undef,$entries)=parse_family($bytes,$family);
        $family_files{$family}++;
        for my $entry (@$entries) {!$names{$family."\0".$entry->{name}}++ or fail('An object occurs in multiple original source files');}
        push @files,{%{raw_item($row,$bytes)},family=>$family,entries=>$entries};
    }
    for my $row (@{array_ref($manifest->{evidenceFiles}//[],'evidence files')}) {
        hash_ref($row,'evidence file');identifier($row->{id},'evidence id');!$ids{$row->{id}}++ or fail('Duplicate evidence/file id');
        my $bytes=read_bytes(text($row->{path},'evidence path',8192,0),$RAW_LIMIT);
        ($total+=length($bytes))<=160_000_000 or fail('Total original input exceeds 160 MB');
        push @evidence,{%{raw_item($row,$bytes)},purpose=>text($row->{purpose},'evidence purpose',4096,0)};
    }
    for my $family (@FAMILIES) {$manifest->{completeness}{$family} && !$family_files{$family} and fail('Complete native family requires its original file, including an explicit empty root: '.$family);}
    my %evidence_ids=map {$_->{id}=>1} @evidence;
    my $context=context_check($manifest->{externalContext}//{},\%evidence_ids);
    my $value={schema=>'otobo.capture.v1',map {$_=>$manifest->{$_}} qw(caseId side workspaceReference observedAt evidenceKind completeness)};
    $value->{environment}=environment(); $value->{files}=\@files; $value->{evidenceFiles}=\@evidence; $value->{externalContext}=$context;
    $value->{captureId}=seal($value,'captureId');
    my $body=canonical($value)."\n";length($body)<=$JSON_LIMIT or fail('Complete capture exceeds 256 MB');
    write_new($out,$body);
    return {captureId=>$value->{captureId},files=>scalar(@files),bytes=>length($body),sha256=>sha256_hex($body)};
}
sub verify_capture {
    my ($c)=@_;
    ($c->{schema}//'') eq 'otobo.capture.v1' or fail('Unsupported capture schema');
    capture_metadata($c);
    seal($c,'captureId') eq ($c->{captureId}//'') or fail('Capture identity mismatch');
    hash_ref($c->{environment},'capture environment');hash_ref($c->{environment}{parser},'capture parser');
    my (%objects,%files,%ids,%evidence);
    for my $file (@{array_ref($c->{files},'capture files')}) {
        my $raw=unpack_item($file);!$ids{$file->{id}}++ or fail('Duplicate capture file id');
        my ($tree,$entries)=parse_family($raw,$file->{family});
        same($entries,$file->{entries}) or fail('Original YAML/native tagged tree differs from captured entries');
        $files{$file->{id}}={file=>$file,raw=>$raw,tree=>$tree};
        for my $entry (@$entries) {
            my $key=$file->{family}."\0".$entry->{name};
            !$objects{$key} or fail('Duplicate native object identity');
            $objects{$key}={file=>$file,name=>$entry->{name},value=>$tree->{$file->{family}}{$entry->{name}}};
        }
    }
    for my $file (@{array_ref($c->{evidenceFiles},'capture evidence files')}) {
        unpack_item($file);!$ids{$file->{id}}++ or fail('Duplicate evidence id');text($file->{purpose},'evidence purpose',4096,0);$evidence{$file->{id}}=1;
    }
    context_check($c->{externalContext},\%evidence);
    return {objects=>\%objects,files=>\%files};
}
sub native_at_path {
    my ($root,$path)=@_;
    array_ref($path,'reference path');@$path<=100 or fail('Reference path too deep');
    my $node=$root;
    for my $key (@$path) {
        text($key,'path component',4096,1);
        if (ref($node) eq 'HASH') {exists($node->{$key}) or fail('Reference path is absent');$node=$node->{$key};}
        elsif (ref($node) eq 'ARRAY') {$key =~ /\A(?:0|[1-9][0-9]*)\z/ && $key<@$node or fail('Invalid array reference path');$node=$node->[$key];}
        else {fail('Reference path descends into a scalar');}
    }
    return $node;
}
sub replace_at_path {
    my ($root,$path,$value)=@_;
    @$path or fail('Replacing whole native objects is not a scalar reference override');
    my @parent=@$path;my $key=pop @parent;my $p=native_at_path($root,\@parent);
    if (ref($p) eq 'HASH') {exists($p->{$key}) or fail('Override destination is absent');$p->{$key}=$value;}
    elsif (ref($p) eq 'ARRAY') {$key =~ /\A(?:0|[1-9][0-9]*)\z/ && $key<@$p or fail('Override array position absent');$p->[$key]=$value;}
    else {fail('Override parent is scalar');}
}
sub emit {
    my ($source,$target,$plan,$outdir)=@_;
    my $s=verify_capture($source);my $t=verify_capture($target);
    $source->{side} eq 'source' && $target->{side} eq 'target' or fail('Emission requires separate source and target captures');
    $source->{caseId} eq $target->{caseId} && $source->{caseId} eq ($plan->{caseId}//'') or fail('Case identity mismatch');
    ($plan->{schema}//'') eq 'otobo.handover-plan.v1' && seal($plan,'planId') eq ($plan->{planId}//'') or fail('Plan identity mismatch');
    ($plan->{sourceCaptureId}//'') eq $source->{captureId} && ($plan->{targetCaptureId}//'') eq $target->{captureId} or fail('Plan capture mismatch');
    same($plan->{expectedParser},$source->{environment}{parser}) && same(environment()->{parser},$plan->{expectedParser})
        or fail('Emission must use the exact source parser/profile/module identities');
    text($plan->{reviewer},'reviewer',500,0);instant($plan->{reviewedAt},'reviewedAt');
    my (%decisions,%selected,%actions,@override_receipts);
    for my $d (@{array_ref($plan->{decisions},'decisions')}) {
        hash_ref($d,'decision');
        my $f=text($d->{family},'decision family',64,0);my $name=text($d->{name},'decision name',4096,0);
        my $key=$f."\0".$name;my $original=$s->{objects}{$key} or fail('Decision does not identify an original source object');
        ($d->{sourceFileId}//'') eq $original->{file}{id} && !$decisions{$key}++ or fail('Decision file identity mismatch or duplicate decision');
        my $action=text($d->{action},'action',40,0);text($d->{reason},'decision reason',10000,0);
        $action =~ /\A(?:create|overwrite|keep-target|exclude|replace-pair-permissions|add-links)\z/ or fail('Unknown decision action');
        my $existing=$t->{objects}{$key};
        if ($action eq 'keep-target') {$existing or fail('Cannot keep an absent target object');next;}
        next if $action eq 'exclude';
        $action ne 'create' || $target->{completeness}{$f} or fail('Create/absence requires complete target family evidence');
        if ($f eq 'RoleGroups') {$action eq 'replace-pair-permissions' or fail('RoleGroups requires explicit pair-permission replacement');}
        elsif ($f eq 'QueueTemplates') {$action eq 'add-links' or fail('QueueTemplates supports additive links only');}
        else {
            $action eq 'create' || $action eq 'overwrite' or fail('Ordinary family requires create or overwrite');
            ($action eq 'create' && !$existing) || ($action eq 'overwrite' && $existing) or fail('Create/overwrite does not match independent target capture');
        }
        if ($f eq 'GenericAgents') {JSON::PP::is_bool($d->{genericAgentReviewed}) && $d->{genericAgentReviewed} or fail('GenericAgent schedule/actions require explicit review');}
        # Reparse this exact original file to obtain an independent native subtree for each selection.
        my ($fresh)=parse_family($s->{files}{$original->{file}{id}}{raw},$f);
        my $value=$fresh->{$f}{$name};
        my %paths;
        for my $o (@{array_ref($d->{referenceOverrides}//[],'reference overrides')}) {
            hash_ref($o,'reference override');text($o->{reason},'override reason',10000,0);
            my $path=array_ref($o->{path},'override path');my $path_key=canonical($path);!$paths{$path_key}++ or fail('Duplicate reference override path');
            my $target_file=$t->{files}{$o->{targetFileId}//''} or fail('Override target file is not retained');
            my $target_name=text($o->{targetName},'override target name',4096,0);
            exists($target_file->{tree}{$target_file->{file}{family}}{$target_name}) or fail('Override target object missing');
            my $target_value=native_at_path($target_file->{tree}{$target_file->{file}{family}}{$target_name},$o->{targetPath});
            my $before=native_at_path($value,$path);
            (!ref($target_value) || JSON::PP::is_bool($target_value)) && (!ref($before)||JSON::PP::is_bool($before))
                or fail('Only captured scalar reference overrides are permitted');
            # Names are identity, not a reference. All other paths require an explicit scalar-to-scalar mapping.
            $path->[0] ne 'Name' or fail('The top-level native Name cannot be overridden');
            replace_at_path($value,$path,$target_value);
            push @override_receipts,{sourceFileId=>$d->{sourceFileId},family=>$f,name=>$name,path=>$path,
                targetFileId=>$o->{targetFileId},targetName=>$target_name,targetPath=>$o->{targetPath},
                before=>tagged($before),after=>tagged($target_value),reason=>$o->{reason}};
        }
        service_identity($name,$value) if $f eq 'Services';
        if ($f eq 'Templates' && $action eq 'create' && ref($value) eq 'HASH'
            && defined($value->{PreSelectedTicketStateID}) && "$value->{PreSelectedTicketStateID}" ne '' && "$value->{PreSelectedTicketStateID}" ne '0') {
            fail('Native StandardTemplateAdd omits PreSelectedTicketStateID; selected create cannot preserve this non-null value');
        }
        $selected{$f}{$action}{$name}=$value;
        $actions{$key}=$action;
    }
    keys(%decisions)==keys(%{$s->{objects}}) or fail('The plan must retain a decision for every original source object');
    my $order=array_ref($plan->{importOrder},'reviewed importOrder');
    @$order==keys(%actions) or fail('importOrder must contain every selected decision exactly once');
    my (%ordered,$last_phase,$last_queue_action,@batches);
    my %phase=map {$FAMILIES[$_]=>$_} 0..$#FAMILIES;
    $last_phase=-1; $last_queue_action=-1;
    for my $row (@$order) {
        hash_ref($row,'import order row');
        my $f=text($row->{family},'ordered family',64,0);
        my $name=text($row->{name},'ordered name',4096,0);
        my $key=$f."\0".$name;
        exists($actions{$key}) && !$ordered{$key}++ or fail('importOrder missing/duplicate/unselected object');
        ($row->{sourceFileId}//'') eq $s->{objects}{$key}{file}{id} && ($row->{action}//'') eq $actions{$key}
            or fail('importOrder does not match exact original decision');
        $phase{$f}>=$last_phase or fail('importOrder violates the native family phases');
        $last_phase=$phase{$f};
        my $action=$actions{$key};
        my $value=$selected{$f}{$action}{$name};
        if ($f eq 'Services' && ref($value) eq 'HASH' && defined($value->{Parent}) && length("$value->{Parent}")) {
            my $parent="$value->{Parent}";
            my $pk="Services\0".$parent;
            $parent ne $name or fail('Service cannot be its own parent');
            if (exists $actions{$pk}) {$ordered{$pk} or fail('Selected Service parent must precede its child');}
            else {$t->{objects}{$pk} or fail('Service parent is neither already in target nor selected before child');}
        }
        if ($f eq 'Queues') {
            my $qi=$action eq 'create'?0:1;
            $qi>=$last_queue_action or fail('Queue create bulk must precede overwrite bulk');
            $last_queue_action=$qi;
        }
        # Services are emitted one at a time in the reviewed parent-first order.
        # Every selected Queue of the same action is retained in one native bulk.
        if ($f ne 'Services' && @batches && $batches[-1]{family} eq $f && $batches[-1]{action} eq $action) {
            push @{$batches[-1]{names}},$name;
        } else {push @batches,{family=>$f,action=>$action,names=>[$name]};}
    }
    my %queue_batches;
    for my $b (@batches) {$b->{family} ne 'Queues' || !$queue_batches{$b->{action}}++ or fail('Queue action cannot be fragmented across multiple batches');}
    my @outputs;
    for my $b (@batches) {
        my ($f,$action)=@$b{qw(family action)};
        my %values=map {$_=>$selected{$f}{$action}{$_}} @{$b->{names}};
        my $tree={$f=>\%values};
        my $bytes=native_dump($tree);
        my ($reloaded)=parse_family($bytes,$f);
        same(tagged($tree),tagged($reloaded)) or fail('Native emitted YAML does not preserve selected typed values');
        my $name=sprintf('%03d-%s--%s.yml',1+@outputs,$f,$action);
        my @argv=('bin/otobo.Console.pl','Admin::ImportExport::ImportStandardObject');
        push @argv,'--update' if $action eq 'overwrite';
        push @argv,$name;
        push @outputs,{filename=>$name,family=>$f,action=>$action,
            importUpdate=>($action eq 'overwrite'?JSON::PP::true:JSON::PP::false),
            selectedNames=>$b->{names},commandArgv=>\@argv,
            workingDirectory=>'installed OTOBO root; replace final positional filename with actual emitted file path',
            bytes=>length($bytes),sha256=>sha256_hex($bytes),body=>$bytes};
    }
    @outputs or fail('No selected objects to emit');
    -e $outdir and fail('Output directory already exists; original contents are preserved');
    my $receipt={
        schema=>'otobo.emission.v1',caseId=>$plan->{caseId},planId=>$plan->{planId},
        sourceCaptureId=>$source->{captureId},targetCaptureId=>$target->{captureId},
        reviewer=>$plan->{reviewer},reviewedAt=>$plan->{reviewedAt},environment=>environment(),
        preparedBy=>'TokenJunkieLabs',nativeImportsExecuted=>JSON::PP::false,
        outputs=>[map {my %v=%$_;delete $v{body};\%v} @outputs],referenceOverrides=>\@override_receipts,
        caveats=>[
          'Files are reviewed handover inputs, not evidence of a successful native import.',
          'RoleGroups replaces permissions of mentioned role/group pairs regardless of the general update flag.',
          'QueueTemplates adds links and does not remove absent links.',
          'Keep-target and excluded original objects remain in the complete plan and original captures.',
          'Re-export the target independently after the original operator runs native imports.'
        ],
    };
    $receipt->{emissionId}=seal($receipt,'emissionId');
    mkdir($outdir,0700) or fail('Cannot create output directory');
    write_new(File::Spec->catfile($outdir,'source.capture.json'),canonical($source)."\n");
    write_new(File::Spec->catfile($outdir,'target.capture.json'),canonical($target)."\n");
    write_new(File::Spec->catfile($outdir,'plan.json'),canonical($plan)."\n");
    for my $o (@outputs) {write_new(File::Spec->catfile($outdir,$o->{filename}),$o->{body});}
    write_new(File::Spec->catfile($outdir,'emission.json'),canonical($receipt)."\n");
    write_new(File::Spec->catfile($outdir,'README.txt'),encode('UTF-8',
      "Prepared by TokenJunkieLabs\n\nNative OTOBO configuration handover\nPlan: $plan->{planId}\n".
      "No OTOBO configuration was imported by this helper.\nUse the original OTOBO importer only after operator approval and a restore-ready backup.\n".
      "emission.json declares each family/action and whether the original --update option is needed.\n".
      "RoleGroups is explicit pair-permission replacement; QueueTemplates is additive. Keep the whole directory.\n".
      "After import, independently export the same target families and capture them for reconciliation.\n".
      "Original raw YAML remains embedded byte-for-byte in source.capture.json and target.capture.json.\n"));
    return {emissionId=>$receipt->{emissionId},files=>scalar(@outputs),planId=>$plan->{planId}};
}
sub target_context {
    my ($root,$workspace,$observed,$out)=@_;
    my $path=abs_path($root);defined($path) && -d $path or fail('OTOBO root is unavailable');
    $OTOBO_ROOT=$path;
    my $started_at=strftime('%Y-%m-%dT%H:%M:%SZ',gmtime());
    text($workspace,'workspaceReference',4096,0);instant($observed,'observedAt');
    unshift @INC,$path,File::Spec->catdir($path,'Kernel','cpan-lib');
    require Kernel::System::ObjectManager;
    no warnings 'once';
    local $Kernel::OM=Kernel::System::ObjectManager->new();
    my @queries=(
      ['Valid','Kernel::System::Valid','ValidList',{}],
      ['FollowUp','Kernel::System::Queue','GetFollowUpOptionList',{Valid=>0}],
      ['Locks','Kernel::System::Lock','LockList',{UserID=>1}],
      ['Priorities','Kernel::System::Priority','PriorityList',{Valid=>0}],
      ['States','Kernel::System::State','StateList',{UserID=>1,Valid=>0}],
      ['Owners','Kernel::System::User','UserList',{Type=>'Short',Valid=>0,NoOutOfOffice=>1}],
      ['Salutations','Kernel::System::Salutation','SalutationList',{Valid=>0}],
      ['Signatures','Kernel::System::Signature','SignatureList',{Valid=>0}],
      ['SystemAddresses','Kernel::System::SystemAddress','SystemAddressList',{Valid=>0}],
      ['Queues','Kernel::System::Queue','QueueList',{Valid=>0}],
    );
    my (%lookups,%sets);
    for my $q (@queries) {
        my ($label,$module,$method,$args)=@$q;
        my $obj=$Kernel::OM->Get($module);
        my %map=$obj->$method(%$args);
        %map or fail("Native lookup $label returned no values; completeness is not assumed");
        for my $id (keys %map) {defined($map{$id})&&!ref($map{$id}) or fail('Unexpected native lookup value');$map{$id}="$map{$id}";}
        $lookups{$label}={module=>$module,method=>$method,arguments=>$args,idToName=>\%map};
        my %uniq;my @names=utf16_sort(grep {!$uniq{$_}++} values %map);
        $sets{$label}={values=>\@names,evidenceFileIds=>['native-target-context']};
    }
    my (%shared,%raw_shared);
    my $valid_object=$Kernel::OM->Get('Kernel::System::Valid');
    for my $entry (['Salutation','Salutations'],['Signature','Signatures'],['SystemAddress','SystemAddresses']) {
        my ($kind,$list_name)=@$entry;
        my $module='Kernel::System::'.$kind;
        my $get=$kind.'Get';
        my $object=$Kernel::OM->Get($module);
        my $list=$lookups{$list_name}{idToName};
        my (@entries,@raw);
        my %seen;
        for my $id (utf16_sort(keys %$list)) {
            my %data=$object->$get(ID=>$id);
            %data && defined($data{Name}) && $data{Name} eq $list->{$id}
                or fail('Shared native object disappeared or changed identity during capture');
            !$seen{$data{Name}}++ or fail('Duplicate shared native object name');
            push @raw,{id=>join('',$id),value=>tagged(\%data)};
            my $valid=$valid_object->ValidLookup(ValidID=>$data{ValidID});
            defined($valid) && !ref($valid) or fail('Shared native validity lookup is unresolved');
            $data{Valid}=join('',$valid);
            delete @data{qw(ValidID ID CreateTime ChangeTime)};
            if ($kind eq 'SystemAddress') {
                my $queue_id=$data{QueueID};
                defined($queue_id) && exists($lookups{Queues}{idToName}{$queue_id})
                    or fail('Shared system address target QueueID is unresolved');
                $data{Queue}=$lookups{Queues}{idToName}{$queue_id};
                delete $data{QueueID};
            }
            push @entries,{name=>join('',$data{Name}),value=>tagged(\%data)};
        }
        @entries=sort {encode('UTF-16BE',$a->{name}) cmp encode('UTF-16BE',$b->{name})} @entries;
        $shared{$kind}={entries=>\@entries,complete=>JSON::PP::true,evidenceFileIds=>['native-target-context']};
        $raw_shared{$kind}={module=>$module,getMethod=>$get,originals=>\@raw,
            transformation=>'Original Queue.ExportQueues: ValidID→Valid; remove ID/CreateTime/ChangeTime; SystemAddress QueueID→Queue'};
    }
    my $config=$Kernel::OM->Get('Kernel::Config');
    my $permissions=$config->Get('System::Permission');
    array_ref($permissions,'native permissions');
    my @permissions=map {defined($_)&&!ref($_) or fail('Invalid native permission');"$_"} @$permissions;
    my $level=$config->Get('Ticket::Frontend::MaxQueueLevel');
    integer($level,'native maxQueueLevel',1000);
    my $value={schema=>'otobo.target-context-evidence.v1',workspaceReference=>$workspace,observedAt=>$observed,
      evidenceKind=>'native-read',startedAt=>$started_at,completedAt=>strftime('%Y-%m-%dT%H:%M:%SZ',gmtime()),lookups=>\%lookups,originalSharedObjects=>\%raw_shared,
      settings=>{'System::Permission'=>\@permissions,'Ticket::Frontend::MaxQueueLevel'=>0+$level},
      externalContext=>{lookupSets=>\%sets,sharedObjects=>\%shared,
        permissionTypes=>{values=>\@permissions,evidenceFileIds=>['native-target-context']},
        maxQueueLevel=>{value=>0+$level,evidenceFileIds=>['native-target-context']}},
      environment=>environment(),preparedBy=>'TokenJunkieLabs',
      limitations=>['Selected native lookups, all shared queue objects and two settings only; no package completeness or customer data capture.',
        'This is a timestamped native read sequence, not a locked database snapshot. Use the original operator capture window.',
        'OTOBO read methods may populate their normal caches; no configuration import or update is invoked.',
        'Insert this whole file as evidenceFiles id native-target-context and copy its externalContext into the capture manifest.']};
    $value->{evidenceId}=seal($value,'evidenceId');
    my $body=canonical($value)."\n";write_new($out,$body);
    return {evidenceId=>$value->{evidenceId},bytes=>length($body),sha256=>sha256_hex($body)};
}
sub main {
    my @args=@ARGV;my $command=shift(@args)//'';my %o;
    GetOptionsFromArray(\@args,\%o,'manifest=s','out=s','source=s','target=s','plan=s','out-dir=s',
        'otobo-root=s','workspace-reference=s','observed-at=s') or fail('Invalid command options');
    @args==0 or fail('Unexpected command argument');
    if ($o{'otobo-root'}) {
        $OTOBO_ROOT=abs_path($o{'otobo-root'});
        defined($OTOBO_ROOT) && -d $OTOBO_ROOT or fail('OTOBO root does not exist');
    }
    my $result;
    if ($command eq 'capture') {$o{manifest} && $o{out} or fail('capture requires --manifest and --out');$result=capture(read_json($o{manifest}),$o{out});}
    elsif ($command eq 'emit') {$o{source} && $o{target} && $o{plan} && $o{'out-dir'} or fail('emit requires --source --target --plan --out-dir');$result=emit(read_json($o{source}),read_json($o{target}),read_json($o{plan}),$o{'out-dir'});}
    elsif ($command eq 'target-context') {$o{'otobo-root'} && $o{'workspace-reference'} && $o{'observed-at'} && $o{out} or fail('target-context requires --otobo-root --workspace-reference --observed-at --out');$result=target_context($o{'otobo-root'},$o{'workspace-reference'},$o{'observed-at'},$o{out});}
    else {fail('Use capture, emit, or target-context. See NATIVE_HELPER.md for the complete source-preserving operating course.');}
    print canonical($result)."\n";
}
unless (caller) {
    my $ok=eval {main();1};
    if (!$ok) {my $message=$@||'Unknown failure';$message =~ s/\n+\z//;print STDERR "$message\n";exit 1;}
}
1;
