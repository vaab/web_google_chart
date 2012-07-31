{
    "name": "web Google Chart",
    # "category" : "Hidden",
    "description":'Openerp web chart view using google chart tools',
    "version": "0.1",
    ## As it replace web_graph, we declare to be dependent to be sure
    ## that it is loaded before.
    "depends": ['web', 'web_graph'],
    "js": [
        "static/lib/google-chart.js",
        "static/src/js/chart.js"],
    "css": [],
    'qweb' : [
        "static/src/xml/*.xml",
    ],
    "auto_install": True
}
