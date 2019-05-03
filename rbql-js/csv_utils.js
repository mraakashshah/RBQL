const readline = require('readline');

let field_regular_expression = '"((?:[^"]*"")*[^"]*)"';
let field_rgx = new RegExp('^' + field_regular_expression);
let field_rgx_external_whitespaces = new RegExp('^' + ' *'+ field_regular_expression + ' *')

function extract_next_field(src, dlm, preserve_quotes, allow_external_whitespaces, cidx, result) {
    var warning = false;
    let src_cur = src.substring(cidx);
    let rgx = allow_external_whitespaces ? field_rgx_external_whitespaces : field_rgx;
    let match_obj = rgx.exec(src_cur);
    if (match_obj !== null) {
        let match_end = match_obj[0].length;
        if (cidx + match_end == src.length || src[cidx + match_end] == dlm) {
            if (preserve_quotes) {
                result.push(match_obj[0]);
            } else {
                result.push(match_obj[1].replace(/""/g, '"'));
            }
            return [cidx + match_end + 1, false];
        }
        warning = true;
    }
    var uidx = src.indexOf(dlm, cidx);
    if (uidx == -1)
        uidx = src.length;
    var field = src.substring(cidx, uidx);
    warning = warning || field.indexOf('"') != -1;
    result.push(field);
    return [uidx + 1, warning];
}


function split_quoted_str(src, dlm, preserve_quotes=false) {
    if (src.indexOf('"') == -1) // Optimization for most common case
        return [src.split(dlm), false];
    var result = [];
    var cidx = 0;
    var warning = false;
    let allow_external_whitespaces = dlm != ' ';
    while (cidx < src.length) {
        var extraction_report = extract_next_field(src, dlm, preserve_quotes, allow_external_whitespaces, cidx, result);
        cidx = extraction_report[0];
        warning = warning || extraction_report[1];
    }
    if (src.charAt(src.length - 1) == dlm)
        result.push('');
    return [result, warning];
}


function occurrences(string, subString, allowOverlapping=false) {
    // @author Vitim.us https://gist.github.com/victornpb/7736865

    string += "";
    subString += "";
    if (subString.length <= 0) return (string.length + 1);

    var n = 0,
        pos = 0,
        step = allowOverlapping ? 1 : subString.length;

    while (true) {
        pos = string.indexOf(subString, pos);
        if (pos >= 0) {
            ++n;
            pos += step;
        } else break;
    }
    return n;
}


function split_whitespace_separated_str(src, preserve_whitespaces=false) {
    var rgxp = preserve_whitespaces ? new RegExp(' *[^ ]+ *', 'g') : new RegExp('[^ ]+', 'g');
    let result = [];
    let match_obj = null;
    while((match_obj = rgxp.exec(src)) !== null) {
        result.push(match_obj[0]);
    }
    return result;
}


function smart_split(src, dlm, policy, preserve_quotes) {
    if (policy === 'simple')
        return [src.split(dlm), false];
    if (policy === 'whitespace')
        return [split_whitespace_separated_str(src, preserve_quotes), false];
    if (policy === 'monocolumn')
        return [[src], false];
    return split_quoted_str(src, dlm, preserve_quotes);
}


function remove_utf8_bom(line, assumed_source_encoding) {
    if (assumed_source_encoding == 'binary' && line.length >= 3 && line.charCodeAt(0) === 0xEF && line.charCodeAt(1) === 0xBB && line.charCodeAt(2) === 0xBF) {
        return line.substring(3);
    }
    if (assumed_source_encoding == 'utf-8' && line.length >= 1 && line.charCodeAt(0) === 0xFEFF) {
        return line.substring(1);
    }
    return line;
}


function make_inconsistent_num_fields_warning(table_name, inconsistent_records_info) {
    // FIXME see python implementation, this is just a stub
    return `Number of fields in "${table_name}" table is not consistent: `;
}


function CSVRecordIterator(stream, encoding, delim, policy, table_name='input') {
    this.stream = stream;
    this.encoding = encoding;
    if (this.encoding) {
        this.stream.setEncoding(this.encoding);
    }
    this.delim = delim;
    this.policy = policy;
    this.table_name = table_name;
    this.line_reader = null;

    this.external_record_callback = null;
    this.external_finish_callback = null;
    this.line_reader_closed = false;
    this.finished = false;

    this.utf8_bom_removed = false;
    this.first_defective_line = null;

    this.fields_info = new Object();
    this.NR = 0;

    this.set_record_callback = function(external_record_callback) {
        this.external_record_callback = external_record_callback;
    }


    this.set_finish_callback = function(external_finish_callback) {
        this.external_finish_callback = external_finish_callback;
    }


    this.process_line = function(line) {
        if (this.finished) {
            return;
        }
        if (this.NR === 0) {
            var clean_line = remove_utf8_bom(line, this.encoding);
            if (clean_line != line) {
                line = clean_line;
                this.utf8_bom_removed = true;
            }
        }
        this.NR += 1;
        var [record, warning] = smart_split(line, this.delim, this.policy, false);
        if (warning && this.first_defective_line === null)
            this.first_defective_line = this.NR;
        let num_fields = record.length;
        if (!this.fields_info.hasOwnProperty(num_fields))
            this.fields_info[num_fields] = this.NR:
        this.external_record_callback(record);
    }

    this.start = function() {
        this.line_reader = readline.createInterface({ input: this.stream });
        this.line_reader.on('line', (line) => { this.process_line(line); });
        this.line_reader.on('close', () => { this.line_reader_closed = true; this.finish(); });
    }

    this.finish = function() {
        if (!this.line_reader_closed) {
            this.line_reader_closed = true;
            this.line_reader.close();
        }
        if (!finished) {
            this.finished = true;
            this.external_finish_callback();
        }
    }

    this.get_warnings = function() {
        if (Object.keys(this.fields_info).length > 1)
            return [make_inconsistent_num_fields_warning('input', this.fields_info)];
        return [];
    }
}


module.exports.split_quoted_str = split_quoted_str;
module.exports.split_whitespace_separated_str = split_whitespace_separated_str;
module.exports.smart_split = smart_split;
