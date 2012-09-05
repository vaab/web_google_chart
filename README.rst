============================
Web Google Chart for OpenERP
============================

This is an OpenERP addons to replace all chart of the web client by
`google chart`_ version. It also adds several new features. Please consult
the list of features further down.

.. _google chart: https://developers.google.com/chart/


Acknowledgments
----------------

Many thanks to `CARIF-OREF La Réunion`_ which has funded the near entirety of
the development of this code.

.. _CARIF-OREF La Réunion: http://www.cariforef-reunion.net/


Requirements
------------

This addons is made for OpenERP version 6.1

Please bear in mind that Google Charts library need to be downloaded from
google's site. So if you have an intranet OpenERP without access to Internet,
this module is not for you.


Installation
------------

Install this as any OpenERP addons, and then look at your charts.


Features
--------

Besides all charts of OpenERP being replaced by google version:

  - several bugs were fixed from original ``chart.js`` from version 6.1.1

  - support of new type 'gauge' and 'pyramid' type of charts.

    For a population pyramid, for example::

      <graph type="pyramid">
        <field name="age" />
        <field name="gender_id" group="True" />
        <field name="nbr" operator="+"/>
      </graph>


  - new aggregation operator ``#`` (namely equivalent to COUNT in SQL), and
    ``avg`` which is self explanatory.

  - all graphs can be customized much more than OpenERP, for example::

      <graph string="Gauge Example" type="gauge">
        <field name="name"/>
        <field name="nbr" operator="+"/>
        <html>
          <graph-options>
            {
              width: 400, height: 120,
              redFrom: 90, redTo: 100,
              yellowFrom:75, yellowTo: 90,
              minorTicks: 5
            }
          </graph-options>
        </html>
      </graph>

   Options are the google chart ones. So documentation is available on
   `google chart`_ site.


Troubleshooting
---------------

- It has occurred on some rare occasion that legacy ``chart.js`` seems to be loaded
  after the javascript code of this module, leading to google chart NOT replacing
  legacy charts. This remains to be confirmed as I cannot reproduce it.

  To check if this is the case in your installation, you can comment the line in
  ``addons/web_graph/static/src/js/chart.js``::

    openerp.web.views.add('graph', 'openerp.web_graph.GraphView');

  which you'll find in the 20 first line of this file. Then ensure your browser
  cache is emptied (``Ctrl-Shift Del`` and select only ``cache``, or use
  ``Ctrl-F5``) to ensure you reload the new javascript. This could help you using
  ``web_google_chart`` if ever it didn't work on your installation.

  Send me the result through the ``Issues`` tab if can reproduce this bug or have
  any information on it.
