

## XXXvlab: monkey patching html_template

from web.controllers import main


def insert_before(source, search, insert_string):
    idx = source.find(search)
    return "%s%s%s" % (source[:idx], insert_string, source[idx:])


def insert_js(src):
    if src not in main.html_template: 
        js_decl = '<script type="text/javascript" src="%s"></script>\n        ' % src
        main.html_template = insert_before(main.html_template, '%(js)', js_decl)


insert_js('https://www.google.com/jsapi')

import re
main.html_template = re.sub(r'(\$\(function\(\) {(.|\n)*}\);)', r'''

        google.load("visualization", "1", {packages:["corechart"]});
        google.setOnLoadCallback(function() {
            \1
        });

''', main.html_template)

pass
