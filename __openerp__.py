{
    "name": "Web Google Chart",
    "category" : "Widgets",
    "description": """Openerp web chart view using google chart tools.

Originally based on legacy ``chart.js`` from openerp ``web_chart`` module.
This modules replaces all charts by google chart version.

""",

    "version": "%%short-version%%",
    ## As it replace web_graph (and that web_graph auto-installs), we
    ## declare to be dependent to be sure that web_graph is loaded
    ## before.
    "depends": ['web', 'web_graph'],
    "js": [
        "static/src/js/chart.js"],
    "css": [],
    'qweb' : [
        "static/src/xml/*.xml",
    ],
}
