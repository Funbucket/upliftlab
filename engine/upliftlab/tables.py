"""Uploaded files as the CSV text the engine reads: CSV bytes in the encodings spreadsheets save, and Excel workbooks.

The browser, the local server and the command line read a workbook with this same code. It uses only the standard
library (zipfile and ElementTree), so nothing extra is installed and every edition sees the same cells. A cell keeps its
stored value: 12000 stays 12000 whatever format Excel showed it in, and a date stays Excel's day number.
"""
import base64
import csv
import io
import posixpath
import zipfile
from pathlib import Path
from xml.etree import ElementTree

from .i18n import tr

EXCEL = ('.xlsx', '.xlsm')


def decode(data):
    """CSV bytes as text: UTF-16 with a byte order mark (Excel's "Unicode text"), UTF-8 with or without one, else CP949,
    which Korean Excel uses for a plain CSV."""
    if data[:2] in (b'\xff\xfe', b'\xfe\xff'):
        return data.decode('utf-16')
    for encoding in ('utf-8-sig', 'cp949'):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            pass
    raise ValueError(tr('파일의 글자 인코딩을 알아보지 못했어요. 엑셀에서 CSV UTF-8 형식으로 다시 저장해 주세요.',
                        'Could not tell the file’s text encoding. Save it again from Excel as CSV UTF-8.'))


def load(path, sheet=None):
    """A file on disk as (CSV text, sheet name or None), for the command line."""
    path = Path(path)
    if path.suffix.lower() == '.xls':
        raise ValueError(xls_message())
    data = path.read_bytes()
    if path.suffix.lower() in EXCEL:
        book = workbook(data, sheet)
        return book['csv'], book['sheet']
    return decode(data), None


def xls_message():
    return tr('엑셀 97-2003 형식(.xls)은 읽지 못해요. 엑셀에서 .xlsx나 CSV로 다시 저장해 주세요.',
              'Excel 97-2003 files (.xls) can’t be read. Save the file again from Excel as .xlsx or CSV.')


def workbook(data, sheet=None):
    """One sheet of an .xlsx file as CSV text: the named sheet, else the first visible sheet that holds a table.

    `data` is the file's bytes, or base64 text from the browser. Returns {'csv', 'sheet', 'sheets'}; sheets lists the
    visible worksheets in workbook order, for the sheet picker."""
    if isinstance(data, str):
        data = base64.b64decode(data)
    try:
        book = zipfile.ZipFile(io.BytesIO(data))
        sheets = _sheets(book)
        strings = _strings(book)
    except (zipfile.BadZipFile, KeyError, ElementTree.ParseError):
        raise ValueError(tr('엑셀 파일을 열지 못했어요. 암호가 걸린 파일이나 엑셀 97-2003(.xls) 파일이면 .xlsx나 CSV로 다시 저장해 주세요.',
                            'Could not open the workbook. If it is password-protected or an Excel 97-2003 (.xls) file, save it again as .xlsx or CSV.')) from None
    if not sheets:
        raise ValueError(tr('워크시트가 없는 엑셀 파일이에요.', 'The workbook has no worksheets.'))
    names = [name for name, _ in sheets]
    if sheet is not None and sheet not in names:
        raise ValueError(tr(f'‘{sheet}’ 시트가 없어요. 있는 시트: {", ".join(names)}', f'There is no sheet ‘{sheet}’. Sheets: {", ".join(names)}'))
    for name, path in sheets:
        if sheet is not None and name != sheet:
            continue
        rows = list(_rows(book, path, strings))
        if sheet is not None or sum(1 for r in rows if len(r) >= 2) >= 2:
            return {'csv': _csv(rows), 'sheet': name, 'sheets': names}
    raise ValueError(tr('표가 있는 시트를 찾지 못했어요. 첫 줄에 열 이름이, 그 아래에 행이 있어야 해요.',
                        'No sheet holds a table. The first line needs the column names, with the rows below it.'))


def _local(tag):
    return tag.rsplit('}', 1)[-1]  # the same names in the transitional and the strict namespaces


def _sheets(book):
    """(name, path inside the zip) of each visible worksheet, in workbook order. Chart sheets and hidden sheets are left out."""
    root = ElementTree.fromstring(book.read('xl/workbook.xml'))
    rels = ElementTree.fromstring(book.read('xl/_rels/workbook.xml.rels'))
    targets = {r.get('Id'): r.get('Target') for r in rels if _local(r.tag) == 'Relationship'}
    out = []
    for node in root.iter():
        if _local(node.tag) != 'sheet' or node.get('state') in ('hidden', 'veryHidden'):
            continue
        rid = next((v for k, v in node.attrib.items() if _local(k) == 'id'), None)
        target = targets.get(rid) or ''
        path = posixpath.normpath(target.lstrip('/') if target.startswith('/') else 'xl/' + target)
        if 'worksheets/' in path:
            out.append((node.get('name'), path))
    return out


def _text(node):
    """The text of a shared or inline string: its <t>, or the <t> of each rich-text run. Phonetic hints (<rPh>) are left out."""
    out = []
    for child in node:
        name = _local(child.tag)
        if name == 't':
            out.append(child.text or '')
        elif name == 'r':
            out.extend(t.text or '' for t in child if _local(t.tag) == 't')
    return ''.join(out)


def _strings(book):
    name = next((n for n in book.namelist() if n.lower() == 'xl/sharedstrings.xml'), None)
    if name is None:
        return []
    out = []
    with book.open(name) as f:
        for _, node in ElementTree.iterparse(f):
            if _local(node.tag) == 'si':
                out.append(_text(node))
                node.clear()
    return out


def _column(ref):
    """0-based column of a cell reference: A1 → 0, AB12 → 27."""
    n = 0
    for ch in ref:
        if not 'A' <= ch <= 'Z':
            break
        n = n * 26 + ord(ch) - 64
    return n - 1


def _rows(book, path, strings):
    """Each row of a worksheet as {column: text}. Booleans become 1 and 0, and error cells (#N/A, #DIV/0!) become blank."""
    with book.open(path) as f:
        for _, node in ElementTree.iterparse(f):
            if _local(node.tag) != 'row':
                continue
            cells, column = {}, 0
            for cell in node:
                if _local(cell.tag) != 'c':
                    continue
                ref = cell.get('r')
                column = _column(ref) if ref else column
                kind, value = cell.get('t'), None
                for part in cell:
                    name = _local(part.tag)
                    if name == 'v':
                        value = part.text or ''
                    elif name == 'is':
                        value = _text(part)
                if value is not None and kind != 'e':
                    cells[column] = strings[int(value)] if kind == 's' else ('1' if value.strip() in ('1', 'true') else '0') if kind == 'b' else value
                column += 1
            node.clear()
            if any(v.strip() for v in cells.values()):
                yield cells


def _csv(rows):
    width = max((max(r) + 1 for r in rows if r), default=0)
    out = io.StringIO()
    writer = csv.writer(out, lineterminator='\n')
    for r in rows:
        writer.writerow([r.get(j, '') for j in range(width)])
    return out.getvalue()
