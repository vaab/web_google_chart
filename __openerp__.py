{
    "name": "web Google Chart",
    "category" : "Hidden",
    "description":'Openerp web chart view using google chart tools',
    "version": "0.1",
    "depends": ['web'],
    "js": [
        "static/lib/google-chart.js",
        "static/src/js/chart.js"],
    "css": [],
    'qweb' : [
        "static/src/xml/*.xml",
    ],
    "auto_install": True
}
