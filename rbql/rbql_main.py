#!/usr/bin/env python
from __future__ import unicode_literals
from __future__ import print_function

import sys
import os
import argparse

from . import csv_utils
from . import rbql_csv
from . import rbql_sqlite
from . import rbql_engine
from . import _version

# TODO support sqlite input join on both sqlite and csv tables - pass 2 join registries
# TODO add demo gif to python package README.md for pypi website

# FIXME add sqlite usage example commands, both interactive and non-interactive modes

PY3 = sys.version_info[0] == 3



history_path = os.path.join(os.path.expanduser("~"), ".rbql_py_query_history")


polymorphic_input = input if PY3 else raw_input


def eprint(*args, **kwargs):
    print(*args, file=sys.stderr, **kwargs)


policy_names = ['quoted', 'simple', 'whitespace', 'quoted_rfc', 'monocolumn']
out_format_names = ['csv', 'tsv', 'input']


polymorphic_xrange = range if PY3 else xrange


def get_default_policy(delim):
    if delim in [';', ',']:
        return 'quoted'
    elif delim == ' ':
        return 'whitespace'
    else:
        return 'simple'


def show_error(error_type, error_msg, is_interactive):
    if is_interactive:
        full_msg = '{}Error [{}]:{} {}'.format('\u001b[31;1m', error_type, '\u001b[0m', error_msg)
        print(full_msg)
    else:
        eprint('Error [{}]: {}'.format(error_type, error_msg))


def show_warning(msg, is_interactive):
    if is_interactive:
        full_msg = '{}Warning:{} {}'.format('\u001b[33;1m', '\u001b[0m', msg)
        print(full_msg)
    else:
        eprint('Warning: ' + msg)


def run_with_python_csv(args, is_interactive):
    if args.debug_mode:
        rbql_csv.set_debug_mode()
    delim = rbql_csv.normalize_delim(args.delim)
    policy = args.policy if args.policy is not None else get_default_policy(delim)
    query = args.query
    skip_header = args.skip_header
    input_path = args.input
    output_path = args.output
    csv_encoding = args.encoding
    args.output_delim, args.output_policy = (delim, policy) if args.out_format == 'input' else rbql_csv.interpret_named_csv_format(args.out_format)
    out_delim, out_policy = args.output_delim, args.output_policy

    user_init_code = rbql_csv.read_user_init_code(args.init_source_file) if args.init_source_file is not None else ''

    warnings = []
    error_type, error_msg = None, None
    try:
        rbql_csv.query_csv(query, input_path, delim, policy, output_path, out_delim, out_policy, csv_encoding, warnings, skip_header, args.comment_prefix, user_init_code, args.color)
    except Exception as e:
        if args.debug_mode:
            raise
        error_type, error_msg = rbql_engine.exception_to_error_info(e)

    if error_type is None:
        success = True
        for warning in warnings:
            show_warning(warning, is_interactive)
    else:
        success = False
        show_error(error_type, error_msg, is_interactive)

    return success


def query_sqlite_to_csv(query_text, db_connection, input_table_name, output_path, output_delim, output_policy, output_csv_encoding, output_warnings, user_init_code, colorize_output):
    output_stream, close_output_on_finish = (None, False)
    join_tables_registry = None
    try:
        output_stream, close_output_on_finish = (sys.stdout, False) if output_path is None else (open(output_path, 'wb'), True)

        if not rbql_csv.is_ascii(query_text) and output_csv_encoding == 'latin-1':
            raise RbqlIOHandlingError('To use non-ascii characters in query enable UTF-8 encoding instead of latin-1/binary')

        if not rbql_csv.is_ascii(output_delim) and output_csv_encoding == 'latin-1':
            raise RbqlIOHandlingError('To use non-ascii separators enable UTF-8 encoding instead of latin-1/binary')

        default_init_source_path = os.path.join(os.path.expanduser('~'), '.rbql_init_source.py')
        if user_init_code == '' and os.path.exists(default_init_source_path):
            user_init_code = rbql_csv.read_user_init_code(default_init_source_path)

        join_tables_registry = rbql_sqlite.SqliteDbRegistry(db_connection)
        input_iterator = rbql_sqlite.SqliteRecordIterator(db_connection, input_table_name)
        output_writer = rbql_csv.CSVWriter(output_stream, close_output_on_finish, output_csv_encoding, output_delim, output_policy, colorize_output=colorize_output)
        rbql_engine.query(query_text, input_iterator, output_writer, output_warnings, join_tables_registry, user_init_code)
    finally:
        if close_output_on_finish:
            output_stream.close()
        if join_tables_registry:
            join_tables_registry.finish(output_warnings)


def run_with_python_sqlite(args, is_interactive):
    import sqlite3
    user_init_code = rbql_csv.read_user_init_code(args.init_source_file) if args.init_source_file is not None else ''

    warnings = []
    error_type, error_msg = None, None
    try:
        db_connection = sqlite3.connect(args.database)
        if args.debug_mode:
            rbql_engine.set_debug_mode()
        query_sqlite_to_csv(args.query, db_connection, args.input, args.output, args.output_delim, args.output_policy, args.encoding, warnings, user_init_code, args.color)
    except Exception as e:
        if args.debug_mode:
            raise
        error_type, error_msg = rbql_engine.exception_to_error_info(e)
    finally:
        db_connection.close()

    if error_type is None:
        success = True
        for warning in warnings:
            show_warning(warning, is_interactive)
    else:
        success = False
        show_error(error_type, error_msg, is_interactive)

    return success


def is_delimited_table(sampled_lines, delim, policy):
    if len(sampled_lines) < 2:
        return False
    num_fields = None
    for sl in sampled_lines:
        fields, warning = csv_utils.smart_split(sl, delim, policy, True)
        if warning or len(fields) < 2:
            return False
        if num_fields is None:
            num_fields = len(fields)
        if num_fields != len(fields):
            return False
    return True


def sample_lines(src_path, encoding, delim, policy, comment_prefix=None):
    # TODO this should be a dependency-free function, remove sample line functionality from CSVRecordIterator
    result = []
    with open(src_path, 'rb') as source:
        line_iterator = rbql_csv.CSVRecordIterator(source, encoding, delim=delim, policy=policy, line_mode=True, comment_prefix=comment_prefix)
        for _i in polymorphic_xrange(10):
            line = line_iterator.polymorphic_get_row()
            if line is None:
                break
            result.append(line)
        return result


def autodetect_delim_policy(input_path, encoding, comment_prefix=None):
    sampled_lines = sample_lines(input_path, encoding, None, None, comment_prefix)
    autodetection_dialects = [('\t', 'simple'), (',', 'quoted'), (';', 'quoted'), ('|', 'simple')]
    for delim, policy in autodetection_dialects:
        if is_delimited_table(sampled_lines, delim, policy):
            return (delim, policy)
    if input_path.endswith('.csv'):
        return (',', 'quoted')
    if input_path.endswith('.tsv'):
        return ('\t', 'simple')
    return (None, None)


def sample_records(input_path, delim, policy, encoding, comment_prefix=None):
    with open(input_path, 'rb') as source:
        record_iterator = rbql_csv.CSVRecordIterator(source, encoding, delim=delim, policy=policy, comment_prefix=comment_prefix)
        sampled_records = record_iterator.get_all_records(num_rows=10);
        warnings = record_iterator.get_warnings()
        return (sampled_records, warnings)


def print_colorized(records, delim, encoding, show_column_names, skip_header):
    # TODO consider colorizing a1,a2,... in different default color
    reset_color_code = '\u001b[0m'
    color_codes = ['\u001b[0m', '\u001b[31m', '\u001b[32m', '\u001b[33m', '\u001b[34m', '\u001b[35m', '\u001b[36m', '\u001b[31;1m', '\u001b[32;1m', '\u001b[33;1m']
    for rnum, record in enumerate(records):
        out_fields = []
        for i, field in enumerate(record):
            color_code = color_codes[i % len(color_codes)]
            if not show_column_names or (skip_header and rnum == 0):
                colored_field = '{}{}'.format(color_code, field)
            else:
                colored_field = '{}a{}:{}'.format(color_code, i + 1, field)
            out_fields.append(colored_field)
        out_line = delim.join(out_fields) + reset_color_code
        if PY3:
            sys.stdout.buffer.write(out_line.encode(encoding))
        else:
            sys.stdout.write(out_line.encode(encoding))
        sys.stdout.write('\n')
        sys.stdout.flush()


def get_default_output_path(input_path, delim):
    well_known_extensions = {',': '.csv', '\t': '.tsv'}
    if delim in well_known_extensions:
        return input_path + well_known_extensions[delim]
    return input_path + '.txt'


def run_interactive_loop(mode, args):
    assert mode in ['csv', 'sqlite']
    import readline
    if os.path.exists(history_path):
        readline.read_history_file(history_path)
    readline.set_history_length(100)
    while True:
        try:
            query = polymorphic_input('Input SQL-like RBQL query and press Enter:\n> ')
            query = query.strip()
        except EOFError:
            print()
            break # Ctrl-D
        if not len(query):
            break
        readline.write_history_file(history_path)
        args.query = query
        if mode == 'csv':
            success = run_with_python_csv(args, is_interactive=True)
        else:
            success = run_with_python_sqlite(args, is_interactive=True)
        if success:
            print('\nOutput table preview:')
            print('====================================')
            records, _warnings = sample_records(args.output, args.output_delim, args.output_policy, args.encoding, comment_prefix=None)
            print_colorized(records, args.output_delim, args.encoding, show_column_names=False, skip_header=False)
            print('====================================')
            print('Success! Result table was saved to: ' + args.output)
            break


def sample_records_sqlite(db_path, table_name):
    import sqlite3
    db_connection = sqlite3.connect(db_path)
    record_iterator = rbql_sqlite.SqliteRecordIterator(db_connection, table_name)
    records = []
    records.append(record_iterator.get_column_names())
    records += record_iterator.get_all_records(num_rows=10)
    db_connection.close()
    return records


def start_preview_mode_sqlite(args):
    db_path = args.database
    table_name = args.input
    assert table_name # FIXME - in interactive mode we can just show the list of available tables so the user can choose the one they need. Or if there is only one table - use it without questions
    records = sample_records_sqlite(db_path, table_name)
    print('Input table preview:')
    print('====================================')
    print_colorized(records, '|', args.encoding, show_column_names=True, skip_header=False)
    print('====================================\n')
    if args.output is None:
        args.output = get_default_output_path('rbql_sqlite_rs', args.output_delim)
        show_warning('Output path was not provided. Result set will be saved as: ' + args.output, is_interactive=True)
    try:
        run_interactive_loop('sqlite', args)
    except KeyboardInterrupt:
        print()


def start_preview_mode_csv(args):
    input_path = args.input
    if not input_path:
        show_error('generic', 'Input file must be provided in interactive mode. You can use stdin input only in non-interactive mode', is_interactive=True)
        return
    if not os.path.exists(input_path):
        show_error('generic', 'Input file {} does not exist'.format(input_path), is_interactive=True)
        return
    if args.delim is not None:
        delim = rbql_csv.normalize_delim(args.delim)
        policy = args.policy if args.policy is not None else get_default_policy(delim)
    else:
        delim, policy = autodetect_delim_policy(input_path, args.encoding, args.comment_prefix)
        if delim is None:
            show_error('generic', 'Unable to autodetect table delimiter. Provide column separator explicitly with "--delim" option', is_interactive=True)
            return
        args.delim = delim
        args.policy = policy
    records, warnings = sample_records(input_path, delim, policy, args.encoding, args.comment_prefix)
    print('Input table preview:')
    print('====================================')
    print_colorized(records, delim, args.encoding, show_column_names=True, skip_header=args.skip_header)
    print('====================================\n')
    for warning in warnings:
        show_warning(warning, is_interactive=True)
    if args.output is None:
        args.output = get_default_output_path(input_path, delim)
        show_warning('Output path was not provided. Result set will be saved as: ' + args.output, is_interactive=True)
    try:
        run_interactive_loop('csv', args)
    except KeyboardInterrupt:
        print()


csv_tool_description = '''
Run RBQL queries against CSV files, sqlite databases

rbql supports two modes: non-interactive (with "--query" option) and interactive (without "--query" option)
Interactive mode shows source table preview which makes query editing much easier. Usage example:
  $ rbql --input input.csv
Non-interactive mode supports reading input tables from stdin and writing output to stdout. Usage example:
  $ rbql --query "select a1, a2 order by a1" --delim , < input.csv

By default rbql works with CSV input files.
To learn how to use rbql to query an sqlite database, run this command:

  $ rbql sqlite --help

'''

csv_epilog = '''
Description of the available CSV split policies:
  * "simple" - RBQL uses simple split() function and doesn't perform special handling of double quote characters
  * "quoted" - Separator can be escaped inside double-quoted fields. Double quotes inside double-quoted fields must be doubled
  * "quoted_rfc" - Same as "quoted", but also allows newlines inside double-quoted fields, see RFC-4180: https://tools.ietf.org/html/rfc4180
  * "whitespace" - Works only with whitespace separator, multiple consecutive whitespaces are treated as a single whitespace
  * "monocolumn" - RBQL doesn't perform any split at all, each line is a single-element record, i.e. only "a1" and "NR" column variables are available
'''


def csv_main():
    parser = argparse.ArgumentParser(prog='rbql [csv]', formatter_class=argparse.RawDescriptionHelpFormatter, description=csv_tool_description, epilog=csv_epilog)
    parser.add_argument('--input', metavar='FILE', help='read csv table from FILE instead of stdin. Required in interactive mode')
    parser.add_argument('--delim', help='delimiter character or multicharacter string, e.g. "," or "###". Can be autodetected in interactive mode')
    parser.add_argument('--policy', help='CSV split policy, see the explanation below. Can be autodetected in interactive mode', choices=policy_names)
    parser.add_argument('--skip-header', action='store_true', help='skip header line in input and join tables. Roughly equivalent of ... WHERE NR > 1 ... in your Query')
    parser.add_argument('--comment-prefix', metavar='PREFIX', help='ignore lines in input and join tables that start with the comment PREFIX, e.g. "#" or ">>"')
    parser.add_argument('--query', help='query string in rbql. Run in interactive mode if empty')
    parser.add_argument('--out-format', help='output format', default='input', choices=out_format_names)
    parser.add_argument('--encoding', help='manually set csv encoding', default=rbql_csv.default_csv_encoding, choices=['latin-1', 'utf-8'])
    parser.add_argument('--output', metavar='FILE', help='write output table to FILE instead of stdout')
    parser.add_argument('--color', action='store_true', help='colorize columns in output in non-interactive mode. Do NOT use if redirecting output to a file')
    parser.add_argument('--version', action='store_true', help='print RBQL version and exit')
    parser.add_argument('--init-source-file', metavar='FILE', help=argparse.SUPPRESS) # Path to init source file to use instead of ~/.rbql_init_source.py
    parser.add_argument('--debug-mode', action='store_true', help=argparse.SUPPRESS) # Run in debug mode
    args = parser.parse_args()

    if args.version:
        print(_version.__version__)
        return

    if args.output is not None and args.color:
        show_error('generic', '"--output" is not compatible with "--color" option', is_interactive=False)
        sys.exit(1)

    if args.policy == 'monocolumn':
        args.delim = ''

    if args.delim is None and args.policy is not None:
        show_error('generic', 'Using "--policy" without "--delim" is not allowed', is_interactive=False)
        sys.exit(1)

    if args.encoding != 'latin-1' and not PY3:
        if args.delim is not None:
            args.delim = args.delim.decode(args.encoding)
        if args.query is not None:
            args.query = args.query.decode(args.encoding)

    if args.query:
        if args.delim is None:
            show_error('generic', 'Separator must be provided with "--delim" option in non-interactive mode', is_interactive=False)
            sys.exit(1)
        if not run_with_python_csv(args, is_interactive=False):
            sys.exit(1)
    else:
        if args.color:
            show_error('generic', '"--color" option is not compatible with interactive mode. Output and Input files preview would be colorized anyway', is_interactive=False)
            sys.exit(1)
        if os.name == 'nt':
            show_error('generic', 'Interactive mode is not available on Windows', is_interactive=False) # TODO: explain why it is not available. Maybe it would work with an advanced terminal emulator?
            sys.exit(1)
        start_preview_mode_csv(args)


sqlite_tool_description = '''
Run RBQL queries against sqlite databases

rbql supports two modes: non-interactive (with "--query" option) and interactive (without "--query" option)
Interactive mode shows source table preview which makes query editing much easier.

'''


def sqlite_main():
    parser = argparse.ArgumentParser(prog='rbql sqlite', formatter_class=argparse.RawDescriptionHelpFormatter, description=sqlite_tool_description)
    parser.add_argument('database', metavar='PATH', help='PATH to sqlite db')
    parser.add_argument('--input', metavar='NAME', help='NAME of the table in sqlite database')
    parser.add_argument('--query', help='query string in rbql. Run in interactive mode if empty')
    parser.add_argument('--out-format', help='output format', default='csv', choices=['csv', 'tsv'])
    parser.add_argument('--output', metavar='FILE', help='write output table to FILE instead of stdout')
    parser.add_argument('--color', action='store_true', help='colorize columns in output in non-interactive mode. Do NOT use if redirecting output to a file')
    parser.add_argument('--version', action='store_true', help='print RBQL version and exit')
    parser.add_argument('--init-source-file', metavar='FILE', help=argparse.SUPPRESS) # Path to init source file to use instead of ~/.rbql_init_source.py
    parser.add_argument('--debug-mode', action='store_true', help=argparse.SUPPRESS) # Run in debug mode
    args = parser.parse_args()

    if args.version:
        print(_version.__version__)
        return

    if args.output is not None and args.color:
        show_error('generic', '"--output" is not compatible with "--color" option', is_interactive=False)
        sys.exit(1)

    args.encoding = 'utf-8'
    args.output_delim, args.output_policy = (',', 'quoted_rfc') if args.out_format == 'csv' else rbql_csv.interpret_named_csv_format(args.out_format)

    if args.query:
        if not run_with_python_sqlite(args, is_interactive=False):
            sys.exit(1)
    else:
        if args.color:
            show_error('generic', '"--color" option is not compatible with interactive mode. Output and Input files preview would be colorized anyway', is_interactive=False)
            sys.exit(1)
        if os.name == 'nt':
            show_error('generic', 'Interactive mode is not available on Windows', is_interactive=False)
            sys.exit(1)
        start_preview_mode_sqlite(args)


def main():
    if len(sys.argv) > 1:
        if sys.argv[1] == 'sqlite':
            del sys.argv[1]
            sqlite_main()
        elif sys.argv[1] == 'csv':
            del sys.argv[1]
            csv_main()
        else:
            # TODO Consider showing "uknown mode" error if the first argument doesn't start with '--'
            csv_main()
    else:
        csv_main()


if __name__ == '__main__':
    main()
