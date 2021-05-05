const fs = require('fs');
const cli_parser = require('../rbql-js/cli_parser.js');
const test_common = require('./test_common.js');
var rbql = null;


function test_test_common() {
    test_common.assert(test_common.assert_arrays_are_equal([100, '20'], [100, '20'], false, true) == true);
    test_common.assert(test_common.assert_arrays_are_equal([100, '20'], [100, '20', 30], false, true) == false);
    test_common.assert(test_common.assert_arrays_are_equal([100, '20'], [100, '20.0'], false, true) == false);
    test_common.assert(test_common.assert_arrays_are_equal([[100, '20'], [10]], [[100, '20'], [10]], false, true) == true);
    test_common.assert(test_common.assert_arrays_are_equal([[100, '20'], [10]], [[100, '20'], [1]], false, true) == false);

    test_common.assert(test_common.assert_objects_are_equal([[100, '20'], [10]], [[100, '20'], [1]], false, true) == false);
    test_common.assert(test_common.assert_objects_are_equal([[100, '20'], [10]], [[100, '20'], [10]], false, true) == true);
    test_common.assert(test_common.assert_objects_are_equal({'foo': 100, 'bar': {'foobar': [10, 20]}}, {'foo': 100, 'bar': {'foobar': [10, 20]}}, false, true) == true);
    test_common.assert(test_common.assert_objects_are_equal({'foo': 100, 'bar': {'foobar': [10, 20]}}, {'foo': 100, 'bar': {'foobar': [10, 20], 'extra': 0}}, false, true) == false);
    test_common.assert(test_common.assert_objects_are_equal({'foo': 100, 'bar': {'foobar': [10, 20], 'extra': 200}}, {'foo': 100, 'bar': {'foobar': [10, 20], 'extra': 0}}, false, true) == false);
    test_common.assert(test_common.assert_objects_are_equal({'foo': 100, 'bar': {'foobar': [10, 20], 'extra': {'hello': 'world'}}}, {'foo': 100, 'bar': {'foobar': [10, 20], 'extra': 0}}, false, true) == false);
}



function vinf(do_init, zb_index) {
    return {initialize: do_init, index: zb_index};
}


function random_choice(values) {
    return values[Math.floor(Math.random() * values.length)];
}


function test_comment_strip() {
    let a = ` // a comment  `;
    let a_strp = rbql.strip_comments(a);
    test_common.assert_equal(a_strp, '');
}


function test_like_to_regex_conversion() {
    let a = '%hello_world.foo.*bar%';
    let b = rbql.like_to_regex(a);
    test_common.assert_equal('^.*hello.world\\.foo\\.\\*bar.*$', b);
}


function test_string_literals_separation() {
    let test_cases = [];
    test_cases.push(['Select 100 order by a1', []]);
    test_cases.push(['Select `hello` order by a1', ['`hello`']]);
    test_cases.push(['Select "hello", 100 order by a1', ['"hello"']]);
    test_cases.push(['Select "hello", *, "world" 100 order by a1 desc', ['"hello"', '"world"']])
    test_cases.push(['Select "hello", "world", "hello \\" world", "hello \\\\\\" world", "hello \\\\\\\\\\\\\\" world" order by "world"', ['"hello"', '"world"', '"hello \\" world"', '"hello \\\\\\" world"', '"hello \\\\\\\\\\\\\\" world"', '"world"']])
    for (let i = 0; i < test_cases.length; i++) {
        let test_case = test_cases[i];
        let query = test_case[0];
        let expected_literals = test_case[1];
        let [format_expression, string_literals] = rbql.separate_string_literals(query);
        test_common.assert_arrays_are_equal(expected_literals, string_literals);
        test_common.assert(query == rbql.combine_string_literals(format_expression, string_literals));
    }
}


function test_separate_actions() {
        let query = 'select top   100 *, a2, a3 inner  join /path/to/the/file.tsv on a1 == b3 where a4 == "hello" and parseInt(b3) == 100 order by parseInt(a7) desc ';
        let expected_res = {'JOIN': {'text': '/path/to/the/file.tsv on a1 == b3', 'join_subtype': 'INNER JOIN'}, 'SELECT': {'text': '*, a2, a3', 'top': 100}, 'WHERE': {'text': 'a4 == "hello" and parseInt(b3) == 100'}, 'ORDER BY': {'text': 'parseInt(a7)', 'reverse': true}};
        let test_res = rbql.separate_actions(query);
        test_common.assert_objects_are_equal(test_res, expected_res);
}


function test_join_parsing() {
    let join_part = '/path/to/the/file.tsv on a1 == b3';
    test_common.assert_arrays_are_equal(['/path/to/the/file.tsv', [['a1', 'b3']]], rbql.parse_join_expression(join_part));

    join_part = ' file.tsv on b[20]== a.name  ';
    test_common.assert_arrays_are_equal(['file.tsv', [['b[20]', 'a.name']]], rbql.parse_join_expression(join_part));

    join_part = ' file.tsv on b[20]== a.name and   a1  ==b3 '
    test_common.assert_arrays_are_equal(['file.tsv', [['b[20]', 'a.name'], ['a1', 'b3']]], rbql.parse_join_expression(join_part));

    join_part = ' file.tsv on b[20]== a.name and   a1  ==b3 and ';
    let catched = false;
    try {
        rbql.parse_join_expression(join_part);
    } catch (e) {
        catched = true;
        test_common.assert(e.toString().indexOf('Invalid join syntax') != -1);
    }
    test_common.assert(catched);

    join_part = ' file.tsv on b[20]== a.name and   a1  ==b3 + "foo" ';
    catched = false;
    try {
        rbql.parse_join_expression(join_part);
    } catch (e) {
        catched = true;
        test_common.assert(e.toString().indexOf('Invalid join syntax') != -1);
    }
    test_common.assert(catched);

    join_part = ' Bon b1 == a.age ';
    catched = false;
    try {
        rbql.parse_join_expression(join_part);
    } catch (e) {
        catched = true;
        test_common.assert(e.toString().indexOf('Invalid join syntax') != -1);
    }
    test_common.assert(catched);

    test_common.assert_arrays_are_equal([['safe_join_get(record_a, 0)'], [1]], rbql.resolve_join_variables({'a1': vinf(true, 0), 'a2': vinf(true, 1)}, {'b1': vinf(true, 0), 'b2': vinf(true, 1)}, [['a1', 'b2']], []));

    catched = false;
    try {
        rbql.parse_join_expression(join_part);
        rbql.resolve_join_variables({'a1': vinf(true, 0), 'a2': vinf(true, 1)}, {'b1': vinf(true, 0), 'b2': vinf(true, 1)}, [['a1', 'a2']], []);
    } catch (e) {
        catched = true;
        test_common.assert(e.toString().indexOf('Invalid join syntax') != -1);
    }
    test_common.assert(catched);

    catched = false;
    try {
        rbql.parse_join_expression(join_part);
        rbql.resolve_join_variables({'a1': vinf(true, 0), 'a2': vinf(true, 1)}, {'b1': vinf(true, 0), 'b2': vinf(true, 1)}, [['a1', 'b10']], []);
    } catch (e) {
        catched = true;
        test_common.assert(e.toString().indexOf('Invalid join syntax') != -1);
    }
    test_common.assert(catched);

    catched = false;
    try {
        rbql.parse_join_expression(join_part);
        rbql.resolve_join_variables({'a1': vinf(true, 0), 'a2': vinf(true, 1)}, {'b1': vinf(true, 0), 'b2': vinf(true, 1)}, [['b1', 'b2']], []);
    } catch (e) {
        catched = true;
        test_common.assert(e.toString().indexOf('Invalid join syntax') != -1);
    }
    test_common.assert(catched);
}


function test_update_translation() {
    let rbql_src = '  a1 =  a2  + b3, a2=a4  if b3 == a2 else a8, a8=   100, a30  =200/3 + 1  ';
    let indent = ' '.repeat(4);
    let expected_dst = [];
    expected_dst.push('safe_set(up_fields, 0, a2  + b3);');
    expected_dst.push(indent + 'safe_set(up_fields, 1, a4  if b3 == a2 else a8);');
    expected_dst.push(indent + 'safe_set(up_fields, 7, 100);');
    expected_dst.push(indent + 'safe_set(up_fields, 29, 200/3 + 1);');
    expected_dst = expected_dst.join('\n');
    let test_dst = rbql.translate_update_expression(rbql_src, {'a1': vinf(true, 0), 'a2': vinf(true, 1), 'a4': vinf(true, 3), 'a8': vinf(true, 7), 'a30': vinf(true, 29)}, [], indent);
    test_common.assert_arrays_are_equal(expected_dst.split('\n'), test_dst.split('\n'));
}



function test_select_translation() {
    let rbql_src = null;
    let test_dst = null;
    let expected_dst = null;

    rbql_src = ' *, a1,  a2,a1,*,*,b1, * ,   * ';
    test_dst = rbql.translate_select_expression(rbql_src)[0];
    expected_dst = '[].concat([]).concat(star_fields).concat([ a1,  a2,a1]).concat(star_fields).concat([]).concat(star_fields).concat([b1]).concat(star_fields).concat([]).concat(star_fields).concat([])';
    test_common.assert(expected_dst === test_dst, 'translation 1');

    rbql_src = ' *, a1,  a2,a1,*,*,*,b1, * ,   * ';
    test_dst = rbql.translate_select_expression(rbql_src)[0];
    expected_dst = '[].concat([]).concat(star_fields).concat([ a1,  a2,a1]).concat(star_fields).concat([]).concat(star_fields).concat([]).concat(star_fields).concat([b1]).concat(star_fields).concat([]).concat(star_fields).concat([])';
    test_common.assert(expected_dst === test_dst, 'translation 2');


    rbql_src = ' *, a1,  a2,a1,*,a.* ,b.* , a.*  , *,*,b1, * ,   * ';
    test_dst = rbql.translate_select_expression(rbql_src)[0];
    expected_dst = '[].concat([]).concat(star_fields).concat([ a1,  a2,a1]).concat(star_fields).concat([]).concat(record_a).concat([]).concat(record_b).concat([]).concat(record_a).concat([]).concat(star_fields).concat([]).concat(star_fields).concat([b1]).concat(star_fields).concat([]).concat(star_fields).concat([])';
    test_common.assert_equal(expected_dst, test_dst);

    rbql_src = ' * ';
    test_dst = rbql.translate_select_expression(rbql_src)[0];
    expected_dst = '[].concat([]).concat(star_fields).concat([])';
    test_common.assert(expected_dst === test_dst);

    rbql_src = ' *,* ';
    test_dst = rbql.translate_select_expression(rbql_src)[0];
    expected_dst = '[].concat([]).concat(star_fields).concat([]).concat(star_fields).concat([])';
    test_common.assert(expected_dst === test_dst);

    rbql_src = ' *,*, * ';
    test_dst = rbql.translate_select_expression(rbql_src)[0];
    expected_dst = '[].concat([]).concat(star_fields).concat([]).concat(star_fields).concat([]).concat(star_fields).concat([])';
    test_common.assert(expected_dst === test_dst);

    rbql_src = ' *,*, * , *';
    test_dst = rbql.translate_select_expression(rbql_src)[0];
    expected_dst = '[].concat([]).concat(star_fields).concat([]).concat(star_fields).concat([]).concat(star_fields).concat([]).concat(star_fields).concat([])';
    test_common.assert(expected_dst === test_dst);
}


function do_randomly_split_replace(query, old_name, new_name) {
    let query_parts = query.split(old_name);
    let result = query_parts[0];
    for (let i = 1; i < query_parts.length; i++) {
        result += random_choice([true, false]) ? old_name : new_name;
        result += query_parts[i];
    }
    return result;
}


function randomly_replace_column_variable_style(query) {
    for (let i = 10; i >= 0; i--) {
        query = do_randomly_split_replace(query, `a${i}`, `a[${i}]`);
        query = do_randomly_split_replace(query, `b${i}`, `b[${i}]`);
    }
    return query;
}


async function test_json_tables() {
    let tests_file_path = 'rbql_unit_tests.json';
    let tests = JSON.parse(fs.readFileSync(tests_file_path, 'utf-8'));
    let filtered_tests = tests.filter(t => test_common.get_default(t, 'skip_others', false));
    if (filtered_tests.length) {
        console.log('Using filtered tests');
        tests = filtered_tests;
    }
    for (let test_case of tests) {
        let test_name = test_case['test_name'];
        console.log('Running rbql test: ' + test_name);
        let query = test_common.get_default(test_case, 'query_js', null);
        if (query == null)
            continue;
        let randomly_replace_var_names = test_common.get_default(test_case, 'randomly_replace_var_names', true);
        if (randomly_replace_var_names)
            query = randomly_replace_column_variable_style(query);
        let input_table = test_case['input_table'];
        let local_debug_mode = test_common.get_default(test_case, 'debug_mode', false);
        let join_table = test_common.get_default(test_case, 'join_table', null);
        let input_column_names = test_common.get_default(test_case, 'input_column_names', null)
        let join_column_names = test_common.get_default(test_case, 'join_column_names', null)
        let normalize_column_names = test_common.get_default(test_case, 'normalize_column_names', true)
        let user_init_code = test_common.get_default(test_case, 'js_init_code', '');
        let expected_output_header = test_common.get_default(test_case, 'expected_output_header', null);
        let expected_output_table = test_common.get_default(test_case, 'expected_output_table', null);
        let expected_error = test_common.get_default(test_case, 'expected_error', null);
        let expected_error_type = test_common.get_default(test_case, 'expected_error_type', null);
        let expected_error_exact = test_common.get_default(test_case, 'expected_error_exact', false);
        if (expected_error == null) {
            expected_error = test_common.get_default(test_case, 'expected_error_js', null);
        }
        let expected_warnings = test_common.get_default(test_case, 'expected_warnings', []);
        let output_table = [];
        let warnings = [];
        let output_column_names = [];
        let error_type = null;
        try {
            await rbql.query_table(query, input_table, output_table, warnings, join_table, input_column_names, join_column_names, output_column_names, normalize_column_names, user_init_code);
        } catch (e) {
            if (local_debug_mode)
                throw(e);
            if (e.constructor.name === 'RbqlParsingError') {
                error_type == 'query_parsing';
            } else if (e.constructor.name === 'RbqlIOHandlingError') {
                error_type == 'IO handling';
            }
            if (expected_error_type)
                test_common.assert_equal(expected_error_type, error_type);
            if(!expected_error) {
                throw(e);
            }
            if (expected_error_exact) {
                test_common.assert_equal(expected_error, e.message);
            } else {
                test_common.assert(e.message.indexOf(expected_error) != -1, `Expected error is not substring of actual. Expected error: ${expected_error}, Actual error: ${e.message}`);
            }
            continue;
        }
        warnings = test_common.normalize_warnings(warnings).sort();
        test_common.assert_arrays_are_equal(expected_warnings, warnings);
        test_common.round_floats(output_table);
        test_common.assert_arrays_are_equal(expected_output_table, output_table);
        if (expected_output_header !== null)
            test_common.assert_arrays_are_equal(expected_output_header, output_column_names);
    }
}


async function test_direct_table_queries() {
    let output_table = [];
    let expected_table = [['foo test', 1], ['bar test', 2]];

    let warnings = [];
    await rbql.query_table('select a2 + " test", a1 limit 2', [[1, 'foo'], [2, 'bar'], [3, 'hello']], output_table, warnings);
    test_common.assert(warnings.length == 0);
    test_common.assert_arrays_are_equal(expected_table, output_table);
}


function test_column_name_parsing() {
    let select_part = 'a1, a[2], a.hello, a["world"], NR, NF, something, foo(something, \'bar\'), "test", 3, 3 + 3, *, a.*, b.*';
    let [select_expression, string_literals] = rbql.separate_string_literals(select_part);
    select_expression = rbql.replace_star_count(select_expression);
    select_expression = rbql.replace_star_vars_for_header_parsing(select_expression);
    let column_infos = rbql.adhoc_parse_select_expression_to_column_infos(select_expression, string_literals);
    let expected = [
        {"table_name":"a","column_index":0,"column_name":null,"is_star":false},
        {"table_name":"a","column_index":1,"column_name":null,"is_star":false},
        {"table_name":null,"column_index":null,"column_name":"hello","is_star":false},
        {"table_name":null,"column_index":null,"column_name":"world","is_star":false},
        {"table_name":null,"column_index":null,"column_name":"NR","is_star":false},
        {"table_name":null,"column_index":null,"column_name":"NF","is_star":false},
        {"table_name":null,"column_index":null,"column_name":"something","is_star":false},
        null,
        null,
        null,
        null,
        {"table_name":null,"column_index":null,"column_name":null,"is_star":true},
        {"table_name":"a","column_index":null,"column_name":null,"is_star":true},
        {"table_name":"b","column_index":null,"column_name":null,"is_star":true},
    ];
    test_common.assert_objects_are_equal(expected, column_infos);
}


async function test_everything() {
    test_test_common();
    test_comment_strip();
    test_like_to_regex_conversion();
    test_string_literals_separation();
    test_separate_actions();
    test_join_parsing();
    test_update_translation();
    test_select_translation();
    test_column_name_parsing();
    await test_direct_table_queries();
    await test_json_tables();
}


function main() {
    console.log('Starting JS unit tests');
    rbql = require('../rbql-js/rbql.js')
    test_everything().then(v => { console.log('Finished JS unit tests'); }).catch(error_info => { console.log('JS tests failed:' + JSON.stringify(error_info)); console.log(error_info.stack); });
}


main();
