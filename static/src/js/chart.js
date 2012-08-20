/*---------------------------------------------------------
 * OpenERP web_google_chart
 *---------------------------------------------------------*/
google_jsapi_loaded = false; 
google_visualization_loaded = false;

openerp.web_google_chart = function (oe) {

var QWeb = oe.web.qweb,
    _t  = oe.web._t,
    _lt = oe.web._lt;

/**
 * Aggregate Functions
 */

/**
 * Creates an aggregate function from aggregate2 fun and a neutral value
 *
 * This only works with agg_fun(x1, ..., xN) = aggregate2(x1, aggregate2(x2 ... aggregate2(xN-1, xN)...))
 */
function make_agg_fun(aggregate2, neutral_value) {
  function agg_fun() {
    if (arguments.length == 0) return neutral_value;
    var args = Array.prototype.slice.call(arguments);
    var first = args.shift();
    if (typeof first === "undefined") return agg_fun.apply(this, args);
    if (args.length == 0) return first;
    return aggregate2(first, agg_fun.apply(this, args));
  };
  return agg_fun
};

var sum = make_agg_fun(function(a, b) { return a + b; }, 0),
    mul = make_agg_fun(function(a, b) { return a * b; }, 1),
    min = make_agg_fun(Math.min, Infinity),
    max = make_agg_fun(Math.max, -Infinity);

function count() { return arguments.length; }
function avg()   { return sum.apply(this, arguments) / count.apply(this, arguments); }
function id(x)   { return x; }

var agg_funs = {
  undefined: id, // No aggregates
  '+': sum,
  '*': mul,
  'min': min,
  'max': max,
  '#': count,
  'avg': avg,
};


/**
 * Miscellanious functions
 */

function capitaliseFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

function mk_field_key(field) {
  return field + ":id";
}


/**
 * Widget code
 */

oe.web.views.add('graph', 'openerp.web_google_chart.ChartView');

oe.web_google_chart.ChartView = oe.web.View.extend({

    display_name: _lt('Graph'),

    init: function(parent, dataset, view_id, options) {
        this._super(parent);
        this.set_default_options(options);
        this.dataset = dataset;
        this.view_id = view_id;

        this.first_field = null;
        this.abscissa = null;
        this.ordinate = null;
        this.columns = [];
        this.group_field = null;
        this.is_loaded = $.Deferred();

        this.renderer = null;
        this.options = {}; // googcle chart options
    },

    stop: function () {
        if (this.renderer) clearTimeout(this.renderer);
        this._super();
    },

    load_google_lib: function () {
        if (typeof(google) !== "undefined") {
            return $.Deferred().resolve(); // nothing to do
        }

        if (google_jsapi_loaded !== false) {
            // this is the deferred which will resolve itself when
            // google jsapi will be loaded.
            return google_jsapi_loaded;
        }
        // is it the global one we are changing ?
        google_jsapi_loaded = $.Deferred();
        window.ginit = function() {
            google_jsapi_loaded.resolve(); 
        };
        console.log('Loading Google jsapi.');
        $.getScript('//www.google.com/jsapi' +
                    '?sensor=false&async=true&callback=ginit');
        return google_jsapi_loaded;
    },

    load_google_visualization_pkgs: function (pkgs) {
        var pkgs_loaded = $.Deferred();
        this.load_google_lib().then(function() {

            if (typeof(google.visualization) !== "undefined") {
                pkgs_loaded.resolve();
                return;
            }

            if (google_visualization_loaded === false) {

                google_visualization_loaded = $.Deferred();
                console.log('Loading Google visualization pkgs:  ' + pkgs.join(', '));
                // google.setOnLoadCallback();
                google.load("visualization", "1", {
                    packages: pkgs,
                    callback: function() {
                        google_visualization_loaded.resolve ();
                    }
                });
            };

            google_visualization_loaded.then(function() { 
                pkgs_loaded.resolve()
            });

        });
        return pkgs_loaded;
    },

    start: function() {
        var self = this;
        this._super();
        var loaded;

        if (this.embedded_view) {
            loaded = $.when([self.embedded_view]);
        } else {
            loaded = this.rpc('/web/view/load', {
                    model: this.dataset.model,
                    view_id: this.view_id,
                    view_type: 'chart'
            });
        }
        return $.when(
            this.dataset.call_and_eval('fields_get', [false, {}], null, 1),
            loaded,
            this.load_google_visualization_pkgs(["corechart", "gauge"]))
            .then(function (fields_result, view_result) {
                self.fields = fields_result[0];
                self.fields_view = view_result[0];
                self.on_loaded(self.fields_view);
            });
    },

    /**
     * Returns all object fields involved in the graph view
     */
    list_fields: function () {
        var fs = [this.abscissa];
        fs.push.apply(fs, _(this.columns).pluck('name'));
        if (this.group_field) fs.push(this.group_field);

        return fs;
    },

      read_options_from_html: function (field) {
      // quick solution that should be thought through much more deeper
      var options;
      _.each(field.children, function(f) {
          if (f.tag == "graph-options") {
            // Eval returns last object
            options = eval("x = " + f.children[0]);
          };
        })
        return options
    },

    on_loaded: function() {
        this.chart = this.fields_view.arch.attrs.type || 'pie';
        this.orientation = this.fields_view.arch.attrs.orientation || 'vertical';

        _.each(this.fields_view.arch.children, function (field) {
            // arch rng stipulates that you could provide 'html'
            // elements that should definitely not be treated as
            // fields
            if (field.tag != "field") {
              // instead we'll use them to store specific google graph options
              if (field.tag == "html")
                this.options = this.read_options_from_html(field);
              return;
            };

            var attrs = field.attrs;
            if (attrs.group) {
                this.group_field = attrs.name;
            } else if(!this.abscissa) {
                this.first_field = this.abscissa = attrs.name;
            } else {
                this.columns.push({
                    name: attrs.name,
                    operator: attrs.operator || '+'
                });
            }
        }, this);
        this.ordinate = this.columns[0].name;
        this.is_loaded.resolve();
    },


      /**
       * Return the fieldname that should be used to store/retrieve
       * the key used when grouping
       */
    _field_key_label: function(field) {
      if (typeof this.fields[field]  === "undefined")
        return field;
      if (_.include(["selection", "many2one"], this.fields[field].type))
        return mk_field_key(field);
      return field; // no need to get a special key. The value is a literal.
    },

      /**
       * Prepares chart data for javascript library
       */
    schedule_chart: function(results) {
        var self = this;
        this.$element.html(QWeb.render("GoogleChartView", {
            "fields_view": this.fields_view,
            "chart": this.chart,
            'element_id': this.widget_parent.element_id
        }));

        var fields = _(this.columns).pluck('name').concat([this.abscissa]);
        if (this.group_field) { fields.push(this.group_field); }
        // transform search result into usable records (convert from OpenERP
        // value shapes to usable atomic types)
        var records = _(results).map(function (result) {
            var point = {};
            _(result).each(function (oe_value, field) {
                if (!_(fields).contains(field)) { return; }
                var value,    // transformed javascript value
                    value_key;  // usable key value if grouping is necessary

                if (oe_value === false) {
                  value = false;
                  value_key = false;
                } else {
                  switch (self.fields[field].type) {
                  case 'selection':
                    var select = _(self.fields[field].selection).detect(function (choice) {
                        return choice[0] === oe_value;
                      });
                    value = select[1];
                    value_key = select[0];
                    break;
                  case 'many2one':
                    value = oe_value[1];
                    value_key = oe_value[0];
                    break;
                  case 'integer': case 'float': case 'char':
                  case 'date': case 'datetime':
                    value = oe_value;
                    value_key = oe_value;
                    break;
                  default:
                    throw new Error(
                                    "Unknown field type " + self.fields[field].type
                                    + "for field " + field + " (" + oe_value + ")");
                  }
                };

                point[field] = value;
                // storing id to keep a good grouping key
                if (_.include([self.abscissa, self.group_field], field))
                  point[self._field_key_label(field)] = value_key;
            });
            return point;
        });

        return this.schedule_widget_draw(records);
    },


      /**
       * Returns Google Chart data type for given openerp fieldname
       *
       */
    g_column_type: function(field) {
      var oe_type = this.fields[field].type;
      if (_.include(['integer', 'float'], oe_type))
        return "number";
      return "string";
    },

      /**
       * Group records along the given group_fields
       *
       * It'll accumulate values of self.columns field according to their operator
       */
    group_records: function(records, group_fields) {

      var self = this;
      var group_values = {};  // assoc group_field -> list of record values
      var group_labels = {};   // assoc group_field -> (assoc key -> label)

      var key_fieldname = {};
      _(group_fields).each(function (group_field) {
          key_fieldname[group_field] = self._field_key_label(group_field);
        });

      var graph_data = {};
      _(records).each(function (record) {

          var group_keys = {};         // assoc group_field -> record value
          var subdct = graph_data;     // dict pointer
          _(group_fields).each(function (group_field) {
              var key = record[key_fieldname[group_field]];
              group_keys[group_field] = key;

              if (typeof group_values[group_field] === "undefined") {
                group_values[group_field] = [];
                group_labels[group_field] = {};
              };

              if (!_.include(group_values[group_field], key)) {
                group_values[group_field].push(key);
                group_labels[group_field][key] = record[group_field]?record[group_field]:
                  _t("unspecified");
              };

              // create sub dict if not existent.
              if (typeof subdct[key] === "undefined") subdct[key] = {}

              subdct = subdct[key];                 // move subdct pointer to inner dict
            });

          var datapoint = subdct;

          _(self.columns).each(function (column) {
              var val       = record[column.name],    // new value to accumulate
                  aggregate = datapoint[column.name]; // previous value of accumulator
              datapoint[column.name] = [val].concat((typeof aggregate !== "undefined")?aggregate:[]);
          });

      });

      // we want to sort grouped field upon it's real label and not it's numeric id.
      _(group_fields).each(function (group_field) {
          group_values[group_field] = _(group_values[group_field]).sortBy(function (key) {
              return group_labels[group_field][key];
            });
        });

      this.group_values = group_values; // save for selection purpose
      this.group_labels = group_labels; // save for column titles

      return graph_data;
    },

    prepare_data_grouped_bar: function(records) {
      var self = this;

        var graph_data = this.group_records(records, [this.abscissa, this.group_field]);

        var column = self.columns[0]; // ONLY ONE column is supported for now.

        /*
         * Convert to google data container format
         */

        graph_data = _(self.group_values[this.abscissa]).map(function(abscissa_key) {
            var line = graph_data[abscissa_key];
            return [self.group_labels[self.abscissa][abscissa_key]].concat(
                _(self.group_values[self.group_field]).map(function(group_key) {
                    return agg_funs[column.operator].apply(
                        this, (line[group_key]?line[group_key][column.name]:[]));
                }));
        });

        var columns_title = _([self.fields[this.abscissa].string]).concat(
          _(this.group_values[this.group_field]).map(function (group_key) {
            return self.group_labels[self.group_field][group_key];
          }));

        return google.visualization.arrayToDataTable([columns_title].concat(graph_data));
    },

    prepare_data_bar: function(records) {
      var self = this;

      var graph_data = this.group_records(records, [this.abscissa, ]);

        /*
         * Convert to google data containuer
         */
        var data = new google.visualization.DataTable();

        // ensure the abscissa is first column
        var columns_name = [self.abscissa].concat(_(this.columns).pluck("name"));

        _(columns_name).each(function (field) {
            var oe_type = self.fields[field].type;
            var type = self.g_column_type(field);
            data.addColumn(type, self.fields[field].string);
          });

        var rows = _(self.group_values[this.abscissa]).map(function(key) {
            var record = graph_data[key];
            var abscissa_label = self.group_labels[self.abscissa][key];
            return [abscissa_label].concat(_(self.columns).map(function(column) {
                  return agg_funs[column.operator].apply(this, record[column.name]);
                }));
          });

        data.addRows(rows);
        return data;
    },

    schedule_widget_draw: function(records) {

        var self = this;
        var options = this.options;             // google chart options associative array
        var view_chart = self.chart;  // google chart widget name
        var data;  // will hold google data object

        if (self.chart == 'bar') {
          view_chart = (this.orientation === 'horizontal') ? 'bar':'column';
        }
        if (self.chart == 'pyramid') {
          // inverting second values
          if (this.columns.length != 2)
            throw new Error('pyramid type only support 2 value columns.' +
                            'You\'ve provided '+ this.columns.length +' colums (' + 
                            _(this.columns).pluck('name').join(", ") +  ')');
          var label = this.columns[1].name;
          _(records).each(function(record) {
              record[label] = -record[label];
            });

          view_chart = 'bar';
          options['isStacked'] = true;
          if (typeof options['hAxis'] === "undefined")
            options['hAxis'] = {};
          options['hAxis']['format'] = ';';
          if (typeof options['vAxis'] === "undefined")
            options['vAxis'] = {};
          options['vAxis']['direction'] = '-1';
        }

        if (!this.group_field || !records.length) {
            data = this.prepare_data_bar(records);
        } else {
            // google chart handles clustered bar charts (> 1 column per abscissa
            // value) and stacked bar charts (basically the same but with the
            // columns on top of one another instead of side by side), but it
            // does not handle clustered stacked bar charts
            if (self.chart == 'bar' && (this.columns.length > 1)) {
                this.$element.text(
                    'OpenERP Web does not support combining grouping and '
                  + 'multiple columns in graph at this time.');
                throw new Error(
                    'google chart can not handle columns counts of that magnitude');
            }
            // transform series for clustered charts into series for stacked
            // charts
            if (self.chart == 'bar') options['isStacked'] = true;

            data = this.prepare_data_grouped_bar(records);
        }

        if (self.chart == 'pyramid') {
          var formatter = new google.visualization.NumberFormat({ pattern: ';' });
          formatter.format(data, 2);
        };

        var renderer = function () {
            if (self.$element.is(':hidden')) {
                self.renderer = setTimeout(renderer, 100);
                return;
            }
            self.renderer = null;

            var google_widget;
            if (view_chart == "gauge")
              google_widget = google.visualization[capitaliseFirstLetter(view_chart)];
            else
              google_widget = google.visualization[capitaliseFirstLetter(view_chart) + "Chart"];
            var chart = new google_widget(
                document.getElementById(self.widget_parent.element_id+"-"+self.chart+"chart"));

            chart.draw(data, options);

            if (view_chart == "gauge") {
              // Gauge's do not support classic google events
              _(self.$element.find('iframe')).each(function(elt, idx) {
                  $(elt).contents().find('body').click(function (event) {
                      self.open_list_view([{'row': idx}]);
                    });
                });
            } else {
              google.visualization.events.addListener(chart, 'select', function() {
                  self.open_list_view(chart.getSelection());
                });
            };
        };

        if (this.renderer) clearTimeout(this.renderer);

        this.renderer = setTimeout(renderer, 0);
    },

    open_list_view : function (select_info){
      var self = this;

      if (!select_info || (select_info.length != 1))
        return;

      var select_obj = select_info[0];
      var abscissa_key, group_key;

      if (typeof(select_obj.row) !== "undefined") {
        abscissa_key = this.group_values[this.abscissa][select_obj.row];
      };
      if ((typeof(select_obj.column) !== "undefined") && this.group_field) {
        group_key = self.group_values[this.group_field][select_obj.column - 1]; // first column were labels
      };

      var views;
      if (this.widget_parent.action) {
        views = this.widget_parent.action.views;
        if (!_(views).detect(function (view) {return view[1] === 'list' })) {
          views = [[false, 'list']].concat(views);
        }
      } else {
        views = _(["list", "form", "graph"]).map(function(mode) {
            return [false, mode];
          });
      };

      var domain =  [[this.abscissa, '=', abscissa_key], ['id','in',this.dataset.ids]];
      if (typeof(group_key) !== "undefined") {
        domain = domain.concat([[this.group_field, '=', group_key]]);
      };

      this.do_action({
        res_model: this.dataset.model,
            'domain': domain,
            views: views,
            type: "ir.actions.act_window",
            flags: {default_view: 'list'}
        });
    },

    do_search: function(domain, context, group_by) {
        var self = this;
        return $.when(this.is_loaded).pipe(function() {
            // TODO: handle non-empty group_by with read_group?
            if (!_(group_by).isEmpty()) {
                self.abscissa = group_by[0];
            } else {
                self.abscissa = self.first_field;
            }
            return self.dataset.read_slice(self.list_fields()).then($.proxy(self, 'schedule_chart'));
        });
    },

    do_show: function() {
        this.do_push_state({});
        return this._super();
    }

});

};

// vim:et fdc=0 fdl=0:
