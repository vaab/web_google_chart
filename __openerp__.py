{
    "name": "Web Google Chart",
    "category" : "Widgets",
    "description": 'Openerp web chart view using google chart tools.

Originally based on legacy chart.js from openerp web_chart module.
This modules replaces all charts by google version. Please do not use 
in conjunction with web_graph module or ensure that this module depends
on it so it can be loaded after web_graph to override it.',

    "version": "0.2",
    ## As it replace web_graph, we declare to be dependent to be sure
    ## that it is loaded before.
    "depends": ['web', 'web_graph'],
    "js": [
        "static/src/js/chart.js"],
    "css": [],
    'qweb' : [
        "static/src/xml/*.xml",
    ],
    "auto_install": True
}
