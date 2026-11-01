"""Audit kontajnera ICDD (ISO 21597-1/-2) po exporte z AIM (D-181).

Spustenie z koreňa repa (len čítanie, bez DB a bez siete)::

    python -m etl.icdd_audit AIM_<versionID>.icdd [--json out.json] [--list-limit 50]

Vypíše stručné zhrnutie a skončí kódom 0 (bez chýb, varovania sú dovolené), 1 (chyba) alebo 2 (súbor sa nedá
prečítať). Kontroly (zadanie Samuela 1. 11. 2026):

* rozloženie ZIP: tri priečinky, hlavička `index.rdf` (iný zápis = varovanie), ontológie v `Ontology resources/`;
* index <-> `Payload documents/` obojsmerne, SHA-256 každého `ct:SecuredDocument`;
* každý súbor v `Payload triples/` je v indexe ako `ct:Linkset` a naopak; varovanie pri prázdnom linksete;
* každý `ls:LinkElement` má `ls:hasDocument` na dokument z indexu; identifikátory majú pole a hodnotu;
* GlobalId (a `IfcDocument*.Identification`) z linksetov existuje v príslušnom IFC;
* žiadne duplicitné väzby (typ, od, do), žiadne osirelé ani visiace `ls:LinkElement`;
* pokrytie: MEP produkty IFC (bez portov) bez väzby na priestor alebo zónu (varovanie, pri prvku bez podlažia chyba);
* žiadne predikáty ani triedy mimo pribalených ontológií (ISO 21597 a aim).

Nie je to normatívna validácia ISO 21597 (oficiálne SHACL tvary z ISO 21597-2 prílohy B nie sú verejné); kardinality
a domény/rozsahy kontroluje `lib/icdd/validate.ts` v exporte. IFC sa číta priamo ako ISO 10303-21 (bez ifcopenshell),
aby audit bežal aj v CI.
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import json
import re
import sys
import zipfile
from dataclasses import dataclass, field
from typing import Iterable, Optional

# Hlavička: ICDDToolkitCore (IIB.ICDD, RUB) ju hľadá presne ako "index.rdf" (ZipArchive.GetEntry, File.Exists) a tak ju
# aj zapisuje; openbim-icdd ju hľadá bez ohľadu na veľkosť písmen a uvádza, že referenčné kontajnery ISO majú
# "index.rdf". Iný zápis (napr. "Index.rdf") je preto varovanie, nie chyba.
INDEX_NAME = "index.rdf"
DIR_ONTOLOGY = "Ontology resources/"
DIR_DOCUMENTS = "Payload documents/"
DIR_TRIPLES = "Payload triples/"

ISO_CT = "https://standards.iso.org/iso/21597/-1/ed-1/en/Container#"
ISO_LS = "https://standards.iso.org/iso/21597/-1/ed-1/en/Linkset#"
ISO_ELS = "https://standards.iso.org/iso/21597/-2/ed-1/en/ExtendedLinkset#"
RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#"
RDFS = "http://www.w3.org/2000/01/rdf-schema#"
OWL = "http://www.w3.org/2002/07/owl#"
XSD = "http://www.w3.org/2001/XMLSchema#"

# Termy RDF/RDFS/OWL, ktoré smú byť v indexe a linksetoch bez deklarácie v pribalenej ontológii.
BUILTIN_PREDICATES = {
    f"{RDF}type",
    f"{RDFS}label",
    f"{RDFS}comment",
    f"{RDFS}seeAlso",
    f"{OWL}imports",
}
BUILTIN_CLASSES = {f"{OWL}Ontology"}
EXCHANGE_VALUES = ("export-only", "import")
DEFAULT_AIM_NS = "urn:x-aim:icdd#"

# Podtriedy IfcDistributionElement (IFC4 ADD2 TC1 + IFC4X3) a IfcFurnishingElement = triedy prvkov, pre ktoré AIM
# odvodzuje väzbu na priestor (derivation_rules: IfcDistributionElement, IfcFurnishingElement). Porty
# (IfcDistributionPort) sú IfcPort, nie IfcDistributionElement, preto v zozname nie sú.
_MEP_NAMES = tuple(
    """
IfcDistributionElement IfcDistributionControlElement IfcActuator IfcAlarm IfcController IfcFlowInstrument
IfcProtectiveDeviceTrippingUnit IfcSensor IfcUnitaryControlElement IfcDistributionFlowElement
IfcDistributionChamberElement IfcEnergyConversionDevice IfcAirToAirHeatRecovery IfcBoiler IfcBurner IfcChiller IfcCoil
IfcCondenser IfcCooledBeam IfcCoolingTower IfcElectricGenerator IfcElectricMotor IfcEngine IfcEvaporativeCooler
IfcEvaporator IfcHeatExchanger IfcHumidifier IfcMotorConnection IfcSolarDevice IfcTransformer IfcTubeBundle
IfcUnitaryEquipment IfcFlowController IfcAirTerminalBox IfcDamper IfcDistributionBoard IfcElectricDistributionBoard
IfcElectricTimeControl IfcFlowMeter IfcProtectiveDevice IfcSwitchingDevice IfcValve IfcFlowFitting
IfcCableCarrierFitting IfcCableFitting IfcDuctFitting IfcJunctionBox IfcPipeFitting IfcFlowMovingDevice IfcCompressor
IfcFan IfcPump IfcFlowSegment IfcCableCarrierSegment IfcCableSegment IfcConveyorSegment IfcDuctSegment IfcPipeSegment
IfcFlowStorageDevice IfcElectricFlowStorageDevice IfcTank IfcFlowTreatmentDevice IfcDuctSilencer
IfcElectricFlowTreatmentDevice IfcFilter IfcInterceptor IfcFlowTerminal IfcAirTerminal IfcAudioVisualAppliance
IfcCommunicationsAppliance IfcElectricAppliance IfcFireSuppressionTerminal IfcLamp IfcLightFixture IfcLiquidTerminal
IfcMedicalDevice IfcMobileTelecommunicationsAppliance IfcOutlet IfcSanitaryTerminal IfcSignal IfcSpaceHeater
IfcStackTerminal IfcWasteTerminal IfcFurnishingElement IfcFurniture IfcSystemFurnitureElement
""".split()
)
MEP_CLASSES = frozenset(c.upper() for c in _MEP_NAMES)
_IFC_CASE = {c.upper(): c for c in _MEP_NAMES}
SPATIAL_TARGETS = frozenset({"IFCSPACE", "IFCSPATIALZONE", "IFCZONE"})


@dataclass
class Issue:
    level: str  # error | warning
    code: str
    message: str
    where: str = ""


@dataclass
class Report:
    file: str
    issues: list[Issue] = field(default_factory=list)
    stats: dict = field(default_factory=dict)
    lists: dict = field(default_factory=dict)

    def error(self, code: str, message: str, where: str = "") -> None:
        self.issues.append(Issue("error", code, message, where))

    def warn(self, code: str, message: str, where: str = "") -> None:
        self.issues.append(Issue("warning", code, message, where))

    def collapse(self) -> None:
        """Rovnaké hlásenia (úroveň, kód, miesto, text) zlúči do jedného s počtom."""
        count = collections.Counter((i.level, i.code, i.message, i.where) for i in self.issues)
        out, seen = [], set()
        for i in self.issues:
            k = (i.level, i.code, i.message, i.where)
            if k in seen:
                continue
            seen.add(k)
            out.append(Issue(i.level, i.code, i.message + (f" ({count[k]}x)" if count[k] > 1 else ""), i.where))
        self.issues = out

    @property
    def errors(self) -> list[Issue]:
        return [i for i in self.issues if i.level == "error"]

    @property
    def warnings(self) -> list[Issue]:
        return [i for i in self.issues if i.level == "warning"]


# --------------------------------------------------------------------------------------------- IFC (ISO 10303-21)

_REC_START = re.compile(rb"#(\d+)\s*=\s*([A-Za-z0-9_]+)\s*\(")
_ROOT_GUID = re.compile(
    rb"#\d+\s*=\s*([A-Za-z0-9_]+)\s*\(\s*'([0-9A-Za-z_$]{22})'(?:\s*,\s*(?:#\d+|\$)\s*,\s*'((?:[^']|'')*)')?"
)
_WANTED = {
    b"IFCRELCONTAINEDINSPATIALSTRUCTURE",
    b"IFCRELREFERENCEDINSPATIALSTRUCTURE",
    b"IFCDOCUMENTINFORMATION",
    b"IFCDOCUMENTREFERENCE",
    b"IFCBUILDINGSTOREY",
}


def decode_step_string(raw: str) -> str:
    """Reťazec ISO 10303-21 (bez úvodzoviek): '' -> ', \\X2\\hhhh\\X0\\, \\X\\hh, \\S\\c."""
    out: list[str] = []
    i, n = 0, len(raw)
    while i < n:
        c = raw[i]
        if c == "'" and raw[i + 1 : i + 2] == "'":
            out.append("'")
            i += 2
        elif raw.startswith("\\X2\\", i):
            end = raw.find("\\X0\\", i + 4)
            if end < 0:
                out.append(raw[i:])
                break
            hexs = raw[i + 4 : end]
            out.append("".join(chr(int(hexs[k : k + 4], 16)) for k in range(0, len(hexs) - 3, 4)))
            i = end + 4
        elif raw.startswith("\\X4\\", i):
            end = raw.find("\\X0\\", i + 4)
            hexs = raw[i + 4 : end if end >= 0 else n]
            out.append("".join(chr(int(hexs[k : k + 8], 16)) for k in range(0, len(hexs) - 7, 8)))
            i = (end + 4) if end >= 0 else n
        elif raw.startswith("\\X\\", i):
            out.append(bytes.fromhex(raw[i + 3 : i + 5]).decode("latin-1"))
            i += 5
        elif raw.startswith("\\S\\", i):
            out.append(chr(ord(raw[i + 3]) + 128))
            i += 4
        elif raw.startswith("\\\\", i):
            out.append("\\")
            i += 2
        else:
            out.append(c)
            i += 1
    return "".join(out)


def parse_step_args(data: bytes, pos: int) -> list:
    """Atribúty záznamu od pozície za '(' po zodpovedajúcu ')'. Odkazy '#12' -> int, reťazce dekódované."""
    stack: list[list] = [[]]
    i, n = pos, len(data)
    while i < n:
        c = data[i : i + 1]
        if c == b"'":
            j = i + 1
            while True:
                j = data.index(b"'", j)
                if data[j + 1 : j + 2] == b"'":
                    j += 2
                    continue
                break
            stack[-1].append(decode_step_string(data[i + 1 : j].decode("latin-1")))
            i = j + 1
        elif c == b"(":
            stack.append([])
            i += 1
        elif c == b")":
            done = stack.pop()
            if not stack:
                return done
            stack[-1].append(done)
            i += 1
        elif c == b"#":
            m = re.compile(rb"#(\d+)").match(data, i)
            stack[-1].append(int(m.group(1)))
            i = m.end()
        elif c in b", \r\n\t":
            i += 1
        else:
            m = re.compile(rb"[^,()]+").match(data, i)
            tok = m.group(0).strip().decode("latin-1")
            stack[-1].append(None if tok in ("$", "*") else tok)
            i = m.end()
    raise ValueError("neukončený záznam STEP")


@dataclass
class IfcIndex:
    """To, čo audit z IFC potrebuje: GlobalId -> trieda, identifikácie dokumentov, prvky natívne v priestore."""

    schema: str = ""
    guid_class: dict[str, str] = field(default_factory=dict)
    guid_name: dict[str, str] = field(default_factory=dict)
    doc_information: set[str] = field(default_factory=set)
    doc_reference: set[str] = field(default_factory=set)
    in_space_natively: set[str] = field(default_factory=set)
    storey_of: dict[str, str] = field(default_factory=dict)  # GlobalId prvku -> meno podlažia (IfcRelContainedIn...)
    # GlobalId prvku -> "Trieda Meno" priestorovej štruktúry, v ktorej je prvok v IFC (obsiahnutý alebo referencovaný)
    structure_of: dict[str, str] = field(default_factory=dict)

    @classmethod
    def parse(cls, data: bytes) -> "IfcIndex":
        idx = cls()
        m = re.search(rb"FILE_SCHEMA\s*\(\s*\(\s*'([^']*)'", data[:4000])
        idx.schema = m.group(1).decode("ascii", "replace") if m else ""
        id_guid: dict[int, str] = {}
        rels: list = []
        storey_name: dict[int, str] = {}
        for mm in _REC_START.finditer(data):
            ent = mm.group(2).upper()
            rid = int(mm.group(1))
            # GlobalId = prvý atribút IfcRoot (22 znakov base64 IFC)
            g = _ROOT_GUID.match(data, mm.start())
            if g:
                guid = g.group(2).decode("ascii")
                idx.guid_class[guid] = ent.decode("ascii")
                if g.group(3) is not None:
                    idx.guid_name[guid] = decode_step_string(g.group(3).decode("latin-1"))
                id_guid[rid] = guid
            if ent in _WANTED:
                args = parse_step_args(data, mm.end())
                if ent == b"IFCBUILDINGSTOREY":
                    storey_name[rid] = args[2] if len(args) > 2 and isinstance(args[2], str) else ""
                elif ent == b"IFCDOCUMENTINFORMATION" and args and isinstance(args[0], str):
                    idx.doc_information.add(args[0])
                elif ent == b"IFCDOCUMENTREFERENCE":
                    # IFC4: Location, Identification, Name, Description, ReferencedDocument; IFC2X3: Location, ItemReference, Name
                    if len(args) > 1 and isinstance(args[1], str):
                        idx.doc_reference.add(args[1])
                else:
                    rels.append((ent, args))
        for ent, args in rels:
            # (GlobalId, OwnerHistory, Name, Description, RelatedElements, RelatingStructure)
            if len(args) < 6 or not isinstance(args[4], list):
                continue
            struct_guid = id_guid.get(args[5]) if isinstance(args[5], int) else None
            struct_cls = idx.guid_class.get(struct_guid or "", "")
            for e in args[4]:
                eg = id_guid.get(e) if isinstance(e, int) else None
                if not eg:
                    continue
                if struct_cls in SPATIAL_TARGETS:
                    idx.in_space_natively.add(eg)
                if struct_guid and eg not in idx.structure_of:
                    idx.structure_of[eg] = f"{struct_cls} {storey_name.get(args[5], '') or struct_guid}"
                if ent == b"IFCRELCONTAINEDINSPATIALSTRUCTURE" and struct_cls == "IFCBUILDINGSTOREY":
                    idx.storey_of[eg] = storey_name.get(args[5], "") or (struct_guid or "")
        return idx


# --------------------------------------------------------------------------------------------- RDF


def _graph(data: bytes, where: str, report: Report):
    import rdflib

    g = rdflib.Graph()
    try:
        g.parse(data=data, format="xml", publicID=f"urn:x-icdd-audit:{where}")
    except Exception as exc:  # noqa: BLE001 - chyba parsera = chyba kontajnera
        report.error("rdf_parse", f"RDF/XML sa nedá prečítať: {exc}", where)
        return None
    return g


def _closure(pairs: Iterable[tuple[str, str]], roots: Iterable[str]) -> set[str]:
    """Všetky termy, ktoré sú (tranzitívne) pod niektorým z `roots`."""
    children: dict[str, set[str]] = collections.defaultdict(set)
    for sub, sup in pairs:
        children[sup].add(sub)
    out, todo = set(), list(roots)
    while todo:
        t = todo.pop()
        if t in out:
            continue
        out.add(t)
        todo.extend(children.get(t, ()))
    return out


def _local(t: str) -> str:
    return re.split(r"[#/:]", t)[-1]


# --------------------------------------------------------------------------------------------- audit


def audit(path: str, list_limit: int = 50) -> Report:
    import rdflib
    from rdflib import URIRef
    from rdflib.namespace import RDF as R
    from rdflib.namespace import RDFS as RS

    rep = Report(file=path)
    try:
        zf = zipfile.ZipFile(path)
    except (OSError, zipfile.BadZipFile) as exc:
        rep.error("zip", f"súbor nie je ZIP: {exc}")
        return rep
    # Priečinky sa porovnávajú bez ohľadu na veľkosť písmen (referenčné kontajnery RUB majú "Payload Documents/",
    # openbim-icdd číta bez ohľadu na veľkosť); iný zápis než v ISO 21597-1 je varovanie.
    actual: dict[str, str] = {}
    case_diff: set[str] = set()
    for info in zf.infolist():
        if info.is_dir():
            continue
        n = info.filename
        head, sep, rest = n.partition("/")
        for d in (DIR_ONTOLOGY, DIR_DOCUMENTS, DIR_TRIPLES):
            if sep and head + "/" != d and (head + "/").lower() == d.lower():
                case_diff.add(f"'{head}/' namiesto '{d}'")
                n = d + rest
        actual[n] = info.filename
    for c in sorted(case_diff):
        rep.warn("layout_case", f"priečinok {c} (ISO 21597-1)")
    names = list(actual)
    nameset = set(names)

    def read(n: str) -> bytes:
        return zf.read(actual[n])

    # --- rozloženie
    for d in (DIR_ONTOLOGY, DIR_DOCUMENTS, DIR_TRIPLES):
        if not any(n.startswith(d) for n in names):
            rep.error("layout", f"chýba priečinok '{d}'")
    index_name = INDEX_NAME
    if INDEX_NAME not in nameset:
        alt = [n for n in names if "/" not in n and n.lower() == INDEX_NAME.lower()]
        if alt:
            index_name = alt[0]
            rep.warn(
                "index_name",
                f"hlavička sa volá '{alt[0]}'; ICDDToolkitCore (RUB) číta len '{INDEX_NAME}', openbim-icdd oba zápisy",
            )
        else:
            rep.error("layout", f"chýba hlavička '{INDEX_NAME}' v koreni kontajnera")
            return rep
    stray = [n for n in names if "/" not in n and n != index_name]
    if stray:
        rep.warn("layout", f"v koreni sú súbory navyše: {', '.join(sorted(stray))}")
    for n in names:
        if "/" in n and n.split("/")[0] + "/" not in (DIR_ONTOLOGY, DIR_DOCUMENTS, DIR_TRIPLES):
            rep.warn("layout", f"súbor mimo troch priečinkov ICDD: {n}")
        elif n.count("/") > 1 and not n.startswith(DIR_DOCUMENTS):
            rep.warn("layout", f"vnorený priečinok: {n}")

    # --- ontológie
    onto_files = sorted(n for n in names if n.startswith(DIR_ONTOLOGY))
    onto = rdflib.Graph()
    for f in onto_files:
        g = _graph(read(f), f, rep)
        if g is not None:
            onto += g
    declared = {str(s) for s in onto.subjects(R.type, None) if isinstance(s, URIRef)}
    sub_class = [(str(s), str(o)) for s, o in onto.subject_objects(RS.subClassOf) if isinstance(o, URIRef)]
    sub_prop = [(str(s), str(o)) for s, o in onto.subject_objects(RS.subPropertyOf) if isinstance(o, URIRef)]
    for term, label in ((f"{ISO_CT}ContainerDescription", "Container.rdf"), (f"{ISO_LS}Link", "Linkset.rdf")):
        if term not in declared:
            rep.error("ontology", f"v '{DIR_ONTOLOGY}' chýba ontológia ISO 21597-1 ({label})")
    link_classes = _closure(sub_class, [f"{ISO_LS}Link"])
    parents: dict[str, set[str]] = collections.defaultdict(set)
    for sub_, sup_ in sub_class:
        parents[sub_].add(sup_)

    def ancestors(t: str) -> set[str]:
        out, todo = set(), [t]
        while todo:
            for p_ in parents.get(todo.pop(), ()):
                if p_ not in out:
                    out.add(p_)
                    todo.append(p_)
        return out

    def link_type(ts: set[str]) -> str:
        """Najšpecifickejší typ väzby (els:IsIdenticalTo pred ls:BinaryLink, ak má väzba oba)."""
        cand = sorted(ts & link_classes)
        return next((t for t in cand if all(u == t or u in ancestors(t) for u in cand)), cand[0])

    has_le = _closure(sub_prop, [f"{ISO_LS}hasLinkElement"])
    rep.stats["ontologies"] = [f[len(DIR_ONTOLOGY) :] for f in onto_files]

    # --- index
    idx = _graph(read(index_name), index_name, rep)
    if idx is None:
        return rep
    ct = lambda local: URIRef(f"{ISO_CT}{local}")  # noqa: E731
    containers = list(idx.subjects(R.type, ct("ContainerDescription")))
    if len(containers) != 1:
        rep.error("index", f"index má {len(containers)} ct:ContainerDescription (má byť 1)", index_name)
    cont = containers[0] if containers else None
    if cont is not None:
        rep.stats["versionID"] = str(idx.value(cont, ct("versionID")) or "")
        rep.stats["conformanceIndicator"] = str(idx.value(cont, ct("conformanceIndicator")) or "")
    docs = set(idx.objects(cont, ct("containsDocument"))) if cont is not None else set()
    doc_file: dict = {}
    internal = {d for d in docs if (d, R.type, ct("InternalDocument")) in idx}
    for d in sorted(docs, key=str):
        fn = idx.value(d, ct("filename"))
        if d in internal:
            if fn is None:
                rep.error("index", f"ct:InternalDocument bez ct:filename: {d}", index_name)
                continue
            doc_file[d] = str(fn)
    payload_files = {n[len(DIR_DOCUMENTS) :] for n in names if n.startswith(DIR_DOCUMENTS)}
    registered = set(doc_file.values())
    for fn in sorted(registered - payload_files):
        rep.error("payload_missing", f"dokument z indexu nie je v '{DIR_DOCUMENTS}': {fn}")
    for fn in sorted(payload_files - registered):
        rep.error("payload_unregistered", f"súbor v '{DIR_DOCUMENTS}' nie je v indexe: {fn}")
    dup = [f for f, c in collections.Counter(doc_file.values()).items() if c > 1]
    for fn in dup:
        rep.error("index", f"dva dokumenty indexu s tým istým ct:filename: {fn}", index_name)

    # sha256
    checked = 0
    for d, fn in sorted(doc_file.items(), key=lambda kv: kv[1]):
        if (d, R.type, ct("SecuredDocument")) not in idx or fn not in payload_files:
            continue
        alg = str(idx.value(d, ct("checksumAlgorithm")) or "")
        want = str(idx.value(d, ct("checksum")) or "").lower()
        if alg.upper().replace("-", "") != "SHA256":
            rep.error("checksum", f"{fn}: nepodporovaný ct:checksumAlgorithm '{alg}'")
            continue
        got = hashlib.sha256(read(DIR_DOCUMENTS + fn)).hexdigest()
        checked += 1
        if got != want:
            rep.error("checksum", f"{fn}: SHA-256 nesedí ({got[:12]}... vs index {want[:12]}...)")
    by_ext = collections.Counter(fn.rsplit(".", 1)[-1].lower() for fn in doc_file.values())
    rep.stats["documents"] = {"total": len(doc_file), "by_type": dict(sorted(by_ext.items())), "sha256_checked": checked}

    # --- linksety
    linkset_nodes = set(idx.objects(cont, ct("containsLinkset"))) if cont is not None else set()
    ls_file = {}
    for l in linkset_nodes:
        if (l, R.type, ct("Linkset")) not in idx:
            rep.error("linkset_register", f"ct:containsLinkset {l} nemá typ ct:Linkset", index_name)
        fn = idx.value(l, ct("filename"))
        if fn is None:
            rep.error("linkset_register", f"linkset {l} bez ct:filename", index_name)
        else:
            ls_file[str(fn)] = l
    triple_files = {n[len(DIR_TRIPLES) :] for n in names if n.startswith(DIR_TRIPLES)}
    for fn in sorted(set(ls_file) - triple_files):
        rep.error("linkset_missing", f"linkset z indexu nie je v '{DIR_TRIPLES}': {fn}")
    for fn in sorted(triple_files - set(ls_file)):
        rep.error("linkset_unregistered", f"súbor v '{DIR_TRIPLES}' nie je v indexe ako ct:Linkset: {fn}")

    # --- predikáty a triedy mimo ontológií (index aj linksety)
    allowed_pred = declared | BUILTIN_PREDICATES
    allowed_cls = declared | BUILTIN_CLASSES

    def check_terms(g, where: str) -> None:
        bad_p = collections.Counter(str(p) for p in g.predicates() if str(p) not in allowed_pred)
        bad_c = collections.Counter(
            str(o) for o in g.objects(None, R.type) if isinstance(o, URIRef) and str(o) not in allowed_cls
        )
        for t, c in sorted(bad_p.items()):
            rep.error("undeclared_term", f"predikát mimo pribalených ontológií: {t} ({c}x)", where)
        for t, c in sorted(bad_c.items()):
            rep.error("undeclared_term", f"trieda mimo pribalených ontológií: {t} ({c}x)", where)
        # typovaný literál, ktorého zápis nezodpovedá dátovému typu (napr. xsd:dateTime "03.06.2022 09:22:38")
        ill: dict[str, list[str]] = collections.defaultdict(list)
        for o in g.objects():
            if isinstance(o, rdflib.Literal) and getattr(o, "ill_typed", False):
                ill[str(o.datatype)].append(str(o))
        for dt, vals in sorted(ill.items()):
            rep.error("literal", f"{len(vals)} literálov nie je platný xsd:{_local(dt)}, napr. '{sorted(vals)[0]}'", where)

    check_terms(idx, index_name)

    # IFC payloady (len tie, na ktoré linksety ukazujú, sa parsujú lenivo)
    ifc_cache: dict[str, Optional[IfcIndex]] = {}

    def ifc_of(fn: str) -> Optional[IfcIndex]:
        if fn not in ifc_cache:
            ifc_cache[fn] = (
                IfcIndex.parse(read(DIR_DOCUMENTS + fn))
                if fn.lower().endswith(".ifc") and fn in payload_files
                else None
            )
        return ifc_cache[fn]

    ls_stats: dict[str, dict] = {}
    guid_missing: dict[str, list[str]] = collections.defaultdict(list)
    guid_checked: collections.Counter = collections.Counter()
    linked_to_space: dict[str, set[str]] = collections.defaultdict(set)  # ifc súbor -> GlobalId s väzbou
    for fn in sorted(ls_file):
        if fn not in triple_files:
            continue
        where = DIR_TRIPLES + fn
        g = _graph(read(where), where, rep)
        if g is None:
            continue
        check_terms(g, where)
        types = collections.defaultdict(set)
        for s, o in g.subject_objects(R.type):
            types[s].add(str(o))
        links = [s for s, ts in types.items() if ts & link_classes]
        elements = {s for s, ts in types.items() if f"{ISO_LS}LinkElement" in ts}
        st = {"links": len(links), "link_elements": len(elements), "by_type": {}}
        # značka výmeny AIM (D-181 dodatok "import"): len informačná, import rozhoduje podľa politiky v kóde
        mark = next((str(o) for p_, o in idx.predicate_objects(ls_file[fn]) if str(p_).endswith("#exchange")), None)
        if mark is not None:
            st["exchange"] = mark
            if mark not in EXCHANGE_VALUES:
                rep.warn("exchange_mark", f"neznáma hodnota aim:exchange '{mark}' (export-only | import)", where)
        st["by_type"] = dict(
            sorted(collections.Counter(_local(link_type(types[l])) for l in links).items())
        )
        ls_stats[fn] = st
        if not links:
            rep.warn("linkset_empty", f"linkset neobsahuje žiadnu väzbu ({len(g)} trojíc)", where)
        # Čítače bez inferencie RDFS hľadajú väzbu podľa presného rdf:type: ICDDToolkitCore (RUB) typy ls: a els:
        # (Part 2), openbim-icdd 0.2 len ls:. Väzbu typovanú len vlastnou triedou (aim:) nenájde ani jeden.
        no_base = collections.Counter(
            _local(link_type(types[l]))
            for l in links
            if not any(t.startswith(ISO_LS) or t.startswith(ISO_ELS) for t in types[l])
        )
        for t, c in sorted(no_base.items()):
            rep.warn(
                "link_base_type",
                f"{c} väzieb {t} nemá typ ls: ani els:; čítač bez inferencie RDFS (ICDDToolkitCore, openbim-icdd) ich nenájde",
                where,
            )
        st["without_ls_type"] = sum(no_base.values())

        # LinkElement -> dokument + identifikátor
        el_key: dict = {}
        el_doc_file: dict = {}
        for e in sorted(elements, key=str):
            ds = list(g.objects(e, URIRef(f"{ISO_LS}hasDocument")))
            if len(ds) != 1:
                rep.error("link_element", f"ls:LinkElement má {len(ds)} ls:hasDocument (má byť 1): {e}", where)
                continue
            d = ds[0]
            if d not in doc_file:
                rep.error("dangling_document", f"ls:hasDocument ukazuje mimo dokumentov indexu: {d}", where)
                continue
            dfn = doc_file[d]
            el_doc_file[e] = dfn
            ids = list(g.objects(e, URIRef(f"{ISO_LS}hasIdentifier")))
            key_parts = []
            for i in ids:
                it = types.get(i, set())
                if f"{ISO_LS}StringBasedIdentifier" in it:
                    val = g.value(i, URIRef(f"{ISO_LS}identifier"))
                    fld = g.value(i, URIRef(f"{ISO_LS}identifierField"))
                    if not val or not str(val).strip() or not fld or not str(fld).strip():
                        rep.error("identifier", f"ls:StringBasedIdentifier bez ls:identifier alebo ls:identifierField: {i}", where)
                        continue
                    key_parts.append(f"{fld}={val}")
                    ifc = ifc_of(dfn)
                    fld_s, val_s = str(fld), str(val)
                    if ifc is None:
                        if dfn.lower().endswith(".ifc"):
                            continue
                        rep.warn("identifier", f"identifikátor {fld_s} v ne-IFC dokumente {dfn} sa nedá overiť", where)
                        continue
                    if fld_s.lower() == "globalid":
                        if fld_s != "GlobalId":
                            rep.warn("identifier", f"ls:identifierField '{fld_s}' namiesto IFC atribútu 'GlobalId'", where)
                        guid_checked[dfn] += 1
                        if val_s not in ifc.guid_class:
                            guid_missing[dfn].append(val_s)
                    elif fld_s == "IfcDocumentInformation.Identification":
                        if val_s not in ifc.doc_information:
                            rep.error("identifier_missing", f"{dfn}: IfcDocumentInformation '{val_s}' v IFC nie je", where)
                    elif fld_s == "IfcDocumentReference.Identification":
                        if val_s not in ifc.doc_reference:
                            rep.error("identifier_missing", f"{dfn}: IfcDocumentReference '{val_s}' v IFC nie je", where)
                    else:
                        rep.warn("identifier", f"neznáme ls:identifierField '{fld_s}' (nedá sa overiť)", where)
                elif f"{ISO_LS}URIBasedIdentifier" in it:
                    uri = g.value(i, URIRef(f"{ISO_LS}uri"))
                    if not uri or not str(uri).strip():
                        rep.error("identifier", f"ls:URIBasedIdentifier bez ls:uri: {i}", where)
                        continue
                    u = str(uri)
                    key_parts.append(f"uri={u}")
                    from urllib.parse import unquote

                    base = unquote(u.split("#", 1)[0])
                    if base and base != dfn:
                        rep.error("identifier", f"ls:uri '{u}' nepatrí dokumentu {dfn}", where)
                    m = re.search(r"#page=(\d+)$", u)
                    if "#" in u and (not m or int(m.group(1)) < 1):
                        rep.error("identifier", f"ls:uri '{u}': fragment nie je platné #page=N", where)
                elif f"{ISO_LS}QueryBasedIdentifier" in it:
                    q = g.value(i, URIRef(f"{ISO_LS}queryExpression"))
                    if not q:
                        rep.error("identifier", f"ls:QueryBasedIdentifier bez ls:queryExpression: {i}", where)
                    key_parts.append(f"query={q}")
                else:
                    rep.error("identifier", f"ls:hasIdentifier bez typu identifikátora: {i}", where)
            el_key[e] = f"{dfn}|{'|'.join(sorted(key_parts))}"

        # linky: konce, osirelé a visiace prvky, duplicity
        used: set = set()
        seen: dict = {}
        for l in sorted(links, key=str):
            ltype = link_type(types[l])
            frm = list(g.objects(l, URIRef(f"{ISO_LS}hasFromLinkElement")))
            to = list(g.objects(l, URIRef(f"{ISO_LS}hasToLinkElement")))
            allel = [o for p in has_le for o in g.objects(l, URIRef(p))]
            for o in allel:
                if o not in elements:
                    rep.error("dangling_element", f"link {_local(str(l))} ukazuje na neexistujúci ls:LinkElement {o}", where)
            used.update(allel)
            directed = bool(frm or to)
            if directed:
                if not frm or not to:
                    rep.error("link", f"smerový link bez from alebo to: {l}", where)
                    continue
                key = (ltype, tuple(sorted(el_key.get(x, str(x)) for x in frm)), tuple(sorted(el_key.get(x, str(x)) for x in to)))
            else:
                ends = sorted({el_key.get(x, str(x)) for x in allel})
                if len(set(allel)) < 2:
                    rep.error("link", f"link má menej ako 2 ls:LinkElement: {l}", where)
                    continue
                key = (ltype, tuple(ends), ())
            if key in seen:
                rep.error("duplicate_link", f"duplicitná väzba {_local(ltype)} {key[1]} -> {key[2]}", where)
            seen[key] = l
            # väzba prvok -> priestor/zóna pre pokrytie
            if directed:
                for t in to:
                    tfn = el_doc_file.get(t)
                    tifc = ifc_of(tfn) if tfn else None
                    tguid = _guid_of(g, t)
                    tcls = tifc.guid_class.get(tguid or "", "") if tifc else ""
                    if tcls in SPATIAL_TARGETS:
                        for f_ in frm:
                            ffn, fg = el_doc_file.get(f_), _guid_of(g, f_)
                            if ffn and fg:
                                linked_to_space[ffn].add(fg)
                                st.setdefault("to_class", collections.Counter())[tcls] += 1
        link_set = set(links)
        orphans = elements - used
        if orphans:
            rep.error("orphan_element", f"{len(orphans)} ls:LinkElement bez väzby (napr. {sorted(map(str, orphans))[0]})", where)
        for key_name, pred in (("roles", "role"), ("basedOnRevision", "basedOnRevision"), ("source", "source")):
            vals = collections.Counter(str(o) for s, p, o in g if _local(str(p)) == pred and s in link_set)
            if vals:
                st[key_name] = dict(sorted(vals.items()))
        if "to_class" in st:
            st["to_class"] = dict(sorted(st["to_class"].items()))

    rep.stats["linksets"] = ls_stats
    for fn, miss in sorted(guid_missing.items()):
        rep.error("guid_missing", f"{fn}: {len(miss)} GlobalId z linksetov v IFC nie je", fn)
        rep.lists[f"guid_missing:{fn}"] = sorted(set(miss))[:list_limit]
    rep.stats["globalid_checked"] = dict(sorted(guid_checked.items()))

    # --- pokrytie MEP produktov väzbou na priestor/zónu
    if any(linked_to_space.values()):
        cov = {}
        for fn in sorted(f for f in payload_files if f.lower().endswith(".ifc")):
            ifc = ifc_of(fn)
            if ifc is None:
                continue
            products = {g: c for g, c in ifc.guid_class.items() if c in MEP_CLASSES}
            if not products:
                continue
            linked = linked_to_space.get(fn, set())
            native = ifc.in_space_natively
            missing = sorted(g for g in products if g not in linked and g not in native)
            # Samuel 1. 11.: bez priestoru/zóny, ale s podlažím (alebo inou priestorovou štruktúrou v IFC) = varovanie;
            # bez akejkoľvek priestorovej príslušnosti = chyba.
            floating = [g for g in missing if g not in ifc.structure_of]
            cov[fn] = {
                "products": len(products),
                "linked": len(products) - len(missing),
                "without_space": len(missing),
                "without_structure": len(floating),
            }
            if missing:
                rep.warn(
                    "coverage",
                    f"{len(missing)} z {len(products)} MEP produktov (bez portov) nemá väzbu na priestor ani zónu",
                    fn,
                )
                rep.lists[f"without_space:{fn}"] = [
                    f"{g} {_ifc_name(products[g])} {ifc.guid_name.get(g, '')}".rstrip()
                    + (f" (podlažie {ifc.storey_of[g]})" if ifc.storey_of.get(g) else f" ({ifc.structure_of[g]})" if g in ifc.structure_of else " (BEZ priestorovej príslušnosti)")
                    for g in missing[:list_limit]
                ]
            if floating:
                rep.error(
                    "coverage_no_structure",
                    f"{len(floating)} MEP produktov nemá priestor, zónu ani podlažie (IfcRelContainedInSpatialStructure)",
                    fn,
                )
        rep.stats["coverage"] = cov
    rep.collapse()
    return rep


def read_links(path: str) -> dict:
    """Väzby kontajnera v tvare, v akom ich číta import AIM (`importRequestFromContents` v `lib/icdd/import.ts`).

    Nezávislé čítanie cez rdflib; pytest ho porovná s výstupom TypeScriptu (`fixtures/icdd/aim-small.links.json`),
    takže export -> import roundtrip je overený dvoma implementáciami. Väzby sú zoradené podľa kanonického kľúča.
    """
    import rdflib
    from rdflib import URIRef
    from rdflib.namespace import RDF as R

    zf = zipfile.ZipFile(path)
    names = {i.filename for i in zf.infolist() if not i.is_dir()}
    index_name = INDEX_NAME if INDEX_NAME in names else next(n for n in names if "/" not in n and n.lower() == INDEX_NAME)
    idx = rdflib.Graph().parse(data=zf.read(index_name), format="xml")
    ct = lambda local: URIRef(f"{ISO_CT}{local}")  # noqa: E731
    ls_ = lambda local: URIRef(f"{ISO_LS}{local}")  # noqa: E731
    aim_ns = DEFAULT_AIM_NS
    for f in sorted(n for n in names if n.startswith(DIR_ONTOLOGY)):
        g = rdflib.Graph().parse(data=zf.read(f), format="xml")
        for s_ in g.subjects(R.type, None):
            if str(s_).endswith("IsReferencedInSpatialStructure"):
                aim_ns = str(s_)[: -len("IsReferencedInSpatialStructure")]
    aim = lambda local: URIRef(f"{aim_ns}{local}")  # noqa: E731

    doc_file = {d: str(idx.value(d, ct("filename"))) for d in idx.subjects(R.type, ct("InternalDocument"))}
    linksets = []
    for l_ in idx.subjects(R.type, ct("Linkset")):
        mark = idx.value(l_, aim("exchange"))
        linksets.append({"layer": re.sub(r"\.rdf$", "", str(idx.value(l_, ct("filename")))), "exchange": str(mark) if mark is not None else None})
    linksets.sort(key=lambda x: x["layer"])

    kinds = {
        f"{ISO_ELS}IsElaboratedBy": "IsElaboratedBy",
        f"{ISO_ELS}IsIdenticalTo": "IsIdenticalTo",
        f"{aim_ns}IsReferencedInSpatialStructure": "IsReferencedInSpatialStructure",
    }

    def end(g, e) -> dict:
        if e is None:
            return {"file": "?", "guid": None, "ident": None, "page": None}
        d = g.value(e, ls_("hasDocument"))
        out = {"file": doc_file.get(d, "?"), "guid": None, "ident": None, "page": None}
        i = g.value(e, ls_("hasIdentifier"))
        if i is not None:
            if (i, R.type, ls_("StringBasedIdentifier")) in g:
                value = str(g.value(i, ls_("identifier")) or "")
                field = str(g.value(i, ls_("identifierField")) or "GlobalId")
                if field == "GlobalId":
                    out["guid"] = value or None
                else:
                    out["ident"] = {"field": field, "value": value}
            u = g.value(i, ls_("uri"))
            m = re.search(r"#page=(\d+)$", str(u)) if u is not None else None
            if m:
                out["page"] = int(m.group(1))
        return out

    def end_key(e: dict) -> str:
        ident = e["guid"] or (f"{e['ident']['field']}={e['ident']['value']}" if e["ident"] else "")
        return f"{e['file']}|{ident}|{e['page'] if e['page'] is not None else ''}"

    def opt(g, s_, local):
        v = g.value(s_, aim(local))
        return str(v) if v is not None else None

    links = []
    for n in sorted(n for n in names if n.startswith(DIR_TRIPLES)):
        layer = re.sub(r"\.rdf$", "", n[len(DIR_TRIPLES):])
        g = rdflib.Graph().parse(data=zf.read(n), format="xml")
        for s_ in set(g.subjects(R.type, None)):
            ts = {str(o) for o in g.objects(s_, R.type)}
            kind = next((kinds[t] for t in sorted(ts) if t in kinds), None)
            if kind is None:
                continue
            if kind == "IsIdenticalTo" and layer == "documents-identity":
                kind = "DocumentIsIdenticalTo"
            if kind in ("IsIdenticalTo", "DocumentIsIdenticalTo"):
                ends = sorted((end(g, e) for e in g.objects(s_, ls_("hasLinkElement"))), key=end_key)
                a, b = (ends + [end(g, None)] * 2)[:2]
            else:
                a, b = end(g, g.value(s_, ls_("hasFromLinkElement"))), end(g, g.value(s_, ls_("hasToLinkElement")))
            links.append({
                "layer": layer, "kind": kind, "from": a, "to": b,
                "relationshipId": opt(g, s_, "relationshipId"), "source": opt(g, s_, "source"),
                "role": opt(g, s_, "role"), "rule": opt(g, s_, "derivationRule"),
                "basedOn": opt(g, s_, "basedOnRevision"), "ifcRelationship": opt(g, s_, "ifcRelationship"),
            })

    def key(l_: dict) -> str:
        return " ".join([l_["kind"], end_key(l_["from"]), end_key(l_["to"])] + [
            l_[k] or "" for k in ("source", "role", "rule", "basedOn", "ifcRelationship", "relationshipId")
        ])

    links.sort(key=key)
    return {"linksets": linksets, "links": links}


def _guid_of(g, element) -> Optional[str]:
    from rdflib import URIRef

    for i in g.objects(element, URIRef(f"{ISO_LS}hasIdentifier")):
        if str(g.value(i, URIRef(f"{ISO_LS}identifierField")) or "").lower() == "globalid":
            v = g.value(i, URIRef(f"{ISO_LS}identifier"))
            return str(v) if v is not None else None
    return None


def _ifc_name(upper: str) -> str:
    return _IFC_CASE.get(upper, upper)


# --------------------------------------------------------------------------------------------- výstup


def format_report(rep: Report) -> str:
    out = [f"ICDD audit: {rep.file}"]
    s = rep.stats
    if "versionID" in s:
        out.append(f"  versionID {s['versionID']}, conformance {s.get('conformanceIndicator')}")
    if "documents" in s:
        d = s["documents"]
        out.append(f"  dokumenty {d['total']} {d['by_type']}, SHA-256 overené {d['sha256_checked']}")
    if "ontologies" in s:
        out.append(f"  ontológie {', '.join(s['ontologies'])}")
    for fn, st in s.get("linksets", {}).items():
        extra = "".join(
            f", {k} {st[k]}" for k in ("to_class", "roles", "basedOnRevision") if k in st
        )
        out.append(f"  linkset {fn}: väzby {st['links']} {st['by_type']}, LinkElement {st['link_elements']}{extra}")
    if s.get("globalid_checked"):
        out.append(f"  GlobalId overené v IFC: {s['globalid_checked']}")
    for fn, c in s.get("coverage", {}).items():
        out.append(f"  pokrytie {fn}: {c['linked']}/{c['products']} MEP produktov s väzbou na priestor/zónu")
    for key, items in rep.lists.items():
        out.append(f"  {key}:")
        out.extend(f"    {x}" for x in items)
    for i in rep.issues:
        out.append(f"  {'CHYBA' if i.level == 'error' else 'varovanie'} [{i.code}] {i.where + ': ' if i.where else ''}{i.message}")
    out.append(f"Výsledok: {'CHYBA' if rep.errors else 'OK'} ({len(rep.errors)} chýb, {len(rep.warnings)} varovaní)")
    return "\n".join(out)


def main(argv: Optional[list[str]] = None) -> int:
    import logging

    logging.getLogger("rdflib").setLevel(logging.CRITICAL)  # neplatné literály hlási audit sám (kód 'literal')
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser(description="Audit kontajnera ICDD (ISO 21597) po exporte z AIM (D-181)")
    p.add_argument("container", help="súbor .icdd")
    p.add_argument("--json", help="zapísať report aj ako JSON")
    p.add_argument("--list-limit", type=int, default=50, help="koľko položiek vypísať v zoznamoch (default 50)")
    a = p.parse_args(argv)
    try:
        rep = audit(a.container, a.list_limit)
    except FileNotFoundError as exc:
        print(f"ICDD audit: {exc}", file=sys.stderr)
        return 2
    print(format_report(rep))
    if a.json:
        with open(a.json, "w", encoding="utf-8") as fh:
            json.dump(
                {"file": rep.file, "ok": not rep.errors, "stats": rep.stats, "lists": rep.lists,
                 "issues": [i.__dict__ for i in rep.issues]},
                fh, ensure_ascii=False, indent=2, default=dict,
            )
    return 1 if rep.errors else 0


if __name__ == "__main__":
    sys.exit(main())
