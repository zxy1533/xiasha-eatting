"""Minimal XLSX reader using ONLY the Python standard library.

Why: the target machine has no openpyxl.  We read the OOXML package directly
with zipfile + xml.etree.ElementTree (SPEC §4.2 cleaning rule 1).

Both t="s" (sharedStrings) and t="inlineStr" branches are implemented.  The
source workbook currently uses shared strings only, but the spec requires
both branches so a re-export from WeChat cannot silently break cleaning.
"""

from __future__ import annotations

import zipfile
import xml.etree.ElementTree as ET
from collections import OrderedDict

MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"

T = lambda tag: f"{{{MAIN_NS}}}{tag}"


def _load_shared_strings(zf: zipfile.ZipFile) -> list[str]:
    """Build the shared-string table. Returns [] when the part is absent."""
    name = "xl/sharedStrings.xml"
    if name not in zf.namelist():
        return []
    root = ET.fromstring(zf.read(name))
    table: list[str] = []
    for si in root.findall(T("si")):
        # A rich-string <si> may hold several <t> runs; concatenate them.
        table.append("".join(node.text or "" for node in si.iter(T("t"))))
    return table


def _sheet_targets(zf: zipfile.ZipFile) -> "OrderedDict[str, str]":
    """Map visible sheet name -> worksheet part path, preserving tab order."""
    workbook = ET.fromstring(zf.read("xl/workbook.xml"))
    rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    rel_map: dict[str, str] = {}
    for rel in rels.findall(f"{{{PKG_REL_NS}}}Relationship"):
        target = rel.get("Target", "")
        # Targets may be "worksheets/sheet2.xml" or "/xl/worksheets/...".
        if target.startswith("/"):
            part = target.lstrip("/")
        elif target.startswith("xl/"):
            part = target
        else:
            part = "xl/" + target
        rel_map[rel.get("Id", "")] = part

    result: "OrderedDict[str, str]" = OrderedDict()
    sheets = workbook.find(T("sheets"))
    if sheets is None:
        return result
    for sheet in sheets.findall(T("sheet")):
        rid = sheet.get(f"{{{REL_NS}}}id", "")
        part = rel_map.get(rid)
        if part:
            result[sheet.get("name", "")] = part
    return result


def _cell_text(cell: ET.Element, shared: list[str]) -> str:
    """Decode one <c> element. Formula cells (embedded images) are ignored."""
    ctype = cell.get("t")
    if ctype == "inlineStr":
        is_node = cell.find(T("is"))
        if is_node is None:
            return ""
        return "".join(node.text or "" for node in is_node.iter(T("t")))
    if ctype == "s":
        value = cell.find(T("v"))
        if value is None or value.text is None:
            return ""
        try:
            idx = int(value.text)
        except ValueError:
            return ""
        return shared[idx] if 0 <= idx < len(shared) else ""
    if ctype in ("str", "n", "b", "e"):
        value = cell.find(T("v"))
        return value.text or "" if value is not None else ""
    # Default (no t attribute): numeric or formula. Skip =DISPIMG() image
    # placeholders so they cannot leak 32-hex-digit IDs into evidence.
    value = cell.find(T("v"))
    if value is None:
        return ""
    formula = cell.find(T("f"))
    if formula is not None:
        return ""
    return value.text or ""


def read_xlsx(path: str) -> "OrderedDict[str, list[list[str]]]":
    """Return {sheet_name: [[cell_text, ...], ...]} for every worksheet."""
    with zipfile.ZipFile(path) as zf:
        shared = _load_shared_strings(zf)
        sheets: "OrderedDict[str, list[list[str]]]" = OrderedDict()
        for sheet_name, part in _sheet_targets(zf).items():
            root = ET.fromstring(zf.read(part))
            rows: list[list[str]] = []
            sheet_data = root.find(T("sheetData"))
            if sheet_data is None:
                sheets[sheet_name] = rows
                continue
            for row in sheet_data.findall(T("row")):
                cells = row.findall(T("c"))
                if not cells:
                    continue
                # Keep column positions: empty cells matter for column-A logic.
                values: list[str] = []
                for cell in cells:
                    ref = cell.get("r", "")
                    col = "".join(ch for ch in ref if ch.isalpha())
                    if col:
                        col_idx = 0
                        for ch in col:
                            col_idx = col_idx * 26 + (ord(ch.upper()) - 64)
                        while len(values) < col_idx - 1:
                            values.append("")
                    values.append(_cell_text(cell, shared).strip())
                rows.append(values)
            sheets[sheet_name] = rows
        return sheets
