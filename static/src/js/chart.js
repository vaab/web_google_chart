/*---------------------------------------------------------
 * OpenERP web_google_chart
 *---------------------------------------------------------*/

openerp.web_google_chart = function (oe) {

var QWeb = oe.web.qweb,
     _lt = oe.web._lt;


/**
 * Aggregate Functions
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

function get_agg_fun(op) {
  switch(op) {
  case '+':
    return make_agg_fun(function(a, b) { return a + b; }, 0);
  case '*':
    return make_agg_fun(function(a, b) { return a * b; }, 1);
  case 'min':
    return make_agg_fun(Math.min, Infinity);
  case 'max':
    return make_agg_fun(Math.max, -Infinity);
  };
};

function get_agg_neutral(op) {
  return get_agg_fun(op)();
}

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
    },

    stop: function () {
        if (this.renderer) {
            clearTimeout(this.renderer);
        }
        this._super();
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
            loaded)
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
        if (this.group_field) {
            fs.push(this.group_field);
        }
        return fs;
    },

    on_loaded: function() {
        this.chart = this.fields_view.arch.attrs.type || 'pie';
        this.orientation = this.fields_view.arch.attrs.orientation || 'vertical';

        _.each(this.fields_view.arch.children, function (field) {
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
        // value shapes to usable atomic types
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
                  point[mk_field_key(field)] = value_key; 
            });
            return point;
        });

        return this.schedule_widget_draw(records);
    },

    g_column_type: function(field) {
      var oe_type = this.fields[field].type;
      if (_.include(['integer', 'float'], oe_type))
        return "number";
      return "string";
    },

    prepare_data_grouped_bar: function(records) {
      var self = this;
        var graph_data = {};
        var abscissas = [];       // list of different abscissas keys
        var abscissas_label = {}; // store association of key -> label for abscissa
        var groups = [];          // list of different group keys
        var groups_label = {};    // store association of key -> label for group if any

        var group_key_fieldname    = self._field_key_label(self.group_field);
        var abscissa_key_fieldname = self._field_key_label(self.abscissa);

        var column = self.columns[0]; // XXXvlab: could we have multi-columns here ?

        _(records).each(function (record) {

            var abscissa_key = record[abscissa_key_fieldname],
              group_key = record[group_key_fieldname];

            if (!_.include(abscissas, abscissa_key)) {
              abscissas.push(abscissa_key);
              abscissas_label[abscissa_key] = record[self.abscissa]?record[self.abscissa]:"unspecified";
            };
            if (!_.include(groups,    group_key)) {
              groups.push(group_key);
              groups_label[group_key] = record[self.group_field]?record[self.group_field]:"unspecified";
            };

            if (!graph_data[abscissa_key])            graph_data[abscissa_key] = {}
            if (!graph_data[abscissa_key][group_key]) graph_data[abscissa_key][group_key] = {}

            var datapoint = graph_data[abscissa_key][group_key];

            // _(self.columns).each(function (column) {
                var val = record[column.name],
                    aggregate = datapoint[column.name];
                datapoint[column.name] = get_agg_fun(column.operator)(aggregate, val);
                return;
            // });

        });

        // we want to sort grouped field upon it's real label and not it's numeric id.
        abscissas = _(abscissas).sortBy(function (key) { return abscissas_label[key]; });
        groups    = _(groups)   .sortBy(function (key) { return groups_label   [key]; });

        self.abscissas = abscissas; // keeping this for selection purpose
        self.groups    = groups;    // keeping this for selection purpose

        self.abscissas_label = abscissas_label; // keeping this for selection purpose
        self.groups_label    = groups_label;    // keeping this for selection purpose

        graph_data = _(abscissas).map(function(abscissa_key) {
            var line = graph_data[abscissa_key];

            return [abscissas_label[abscissa_key]].concat(_(groups).map(function(group_key) {
                  return line[group_key]?line[group_key][column.name]:get_agg_neutral(column.operator);
                }));
        });

        /* Convert to google data containuer
         *
         */

        var columns_title = _([self.fields[self.abscissa].string]).concat(
          _(groups).map(function (group_key) {
            return groups_label[group_key];
          }));

        return google.visualization.arrayToDataTable([columns_title].concat(graph_data));
    },

    prepare_data_bar: function(records) {
      var self = this;
      
        // Aggregate on abscissa field, leave split on group field =>
        // max m*n records where m is the # of values for the abscissa
        // and n is the # of values for the group field
        var graph_data = [];
        var abscissas_label = {};
        var abscissas = [];
        var abscissa_key_fieldname = self._field_key_label(self.abscissa);
        var group_key_fieldname = self._field_key_label(self.group_field);
        
        if (group_key_fieldname) 
          debugger;

        _(records).each(function (record) {

            var abscissa_key = record[abscissa_key_fieldname],
                group_key    = record[group_key_fieldname];

            if (!_.include(abscissas, abscissa_key)) {
              abscissas.push(abscissa_key);
              abscissas_label[abscissa_key] = record[self.abscissa]?record[self.abscissa]:"unspecified";
            };

            var r = _(graph_data).detect(function (potential) {
                // XXXvlab: it seems that goup_key_field can't be set here ?
                return potential[abscissa_key_fieldname] === abscissa_key
                        && (!group_key_fieldname
                            || potential[group_key_fieldname] === group_key);
            });
            var datapoint = r || {};

            datapoint[abscissa_key_fieldname] = abscissa_key;
            // if (group_key_fieldname) { 
            //     datapoint[group_key_fieldname] = group_key; 
            //     if (self.group_field !== group_key_fieldname)
            //       datapoint[self.group_field] = record[self.group_field];
            // }
            _(self.columns).each(function (column) {
                var val = record[column.name],        // value to accumulate
                  aggregate = datapoint[column.name]; // previous value of accumulator
                datapoint[column.name] = get_agg_fun(column.operator)(aggregate, val);
            });

            if (!r) { graph_data.push(datapoint); }
        });
        graph_data = _(graph_data).sortBy(function (point) {
            return point[abscissa_key_fieldname] + '[[--]]' + point[self.group_field];
        });

        /* Convert to google data containuer
         *
         */
        var data = new google.visualization.DataTable();

        // ensure the abscissa is first column
        var columns_name = [self.abscissa].concat(_(this.columns).pluck("name"));
        var columns_keys = [abscissa_key_fieldname].concat(_(this.columns).pluck("name"));
        // if (this.group_field) { columns.push(this.group_field); }

        var types = {}
        _(columns_name).each(function (field) {
            var oe_type = self.fields[field].type;
            var type = self.g_column_type(field);
            types[field] = type;
            data.addColumn(type, self.fields[field].string);
          });

        var rows = _(graph_data).map(function(record) {
            var abscissa_key = record[abscissa_key_fieldname];
            var abscissa_label = abscissas_label[abscissa_key];
            var columns = _(self.columns).pluck("name");
            return [abscissa_label].concat(_(columns).map(function(field) {
                switch(types[field]) {
                  case 'string':
                    try {
                      return record[field].toString();
                    } catch(e) {
                      debugger;
                    };
                case 'number':
                  return record[field];
                };
                }));
          });

        self.abscissas = abscissas; // keeping this for selection purpose
        data.addRows(rows);
        return data;
    },

    schedule_widget_draw: function(records) {

        var self = this;
        var options = {};             // google chart options associative array
        var view_chart = self.chart;  // google chart widget name
        var data;  // will hold google data object

        if (self.chart == 'bar') {
          view_chart = (this.orientation === 'horizontal') ? 'bar':'column';
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
                    'dhtmlx can not handle columns counts of that magnitude');
            }
            // transform series for clustered charts into series for stacked
            // charts
            if (self.chart == 'bar') {
              options['isStacked'] = true;
            }
            data = this.prepare_data_grouped_bar(records);
        }

        var renderer = function () {
            if (self.$element.is(':hidden')) {
                self.renderer = setTimeout(renderer, 100);
                return;
            }
            self.renderer = null;

            var google_widget = google.visualization[capitaliseFirstLetter(view_chart) + "Chart"];
            var chart = new google_widget(
                document.getElementById(self.widget_parent.element_id+"-"+self.chart+"chart"));

            chart.draw(data, options);
            google.visualization.events.addListener(chart, 'select', function() {
                self.open_list_view(chart.getSelection());
              });
        };
 
        if (this.renderer) {
            clearTimeout(this.renderer);
        };

        this.renderer = setTimeout(renderer, 0);
    },

    open_list_view : function (select_info){

      var self = this;

      if (!select_info || (select_info.length != 1))
        return;

      var select_obj = select_info[0];
      var abscissa_value, group_value;

      if (typeof(select_obj.row) !== "undefined") {
        abscissa_value = self.abscissas[select_obj.row];
      };
      if (typeof(select_obj.column) !== "undefined") {
        group_value = self.groups[select_obj.column];
      };

      // interpreting abscissa value
      // debugger;
      // if(this.fields[this.abscissa].type == "selection") {
      //   id = _.detect(this.fields[this.abscissa].selection,function(select_value){
      //       return _.include(select_value, id);
      //     });
      // };

      // if (!_.include(['selection', 'integer', 'char'], this.fields[this.abscissa].type)){
      //   throw new Error(
      //                   "Not implemented Error: type " + this.fields[this.abscissa].type 
      //                   + " as abscissa can't be listened. (field: " + this.abscissa + ")");
      // };

      // // interpreting group value
      // if(this.fields[this.group_field].type == "selection") {
      //   id = _.detect(this.fields[this.group_field].selection, function(select_value) {
      //       return _.include(select_value, id);
      //     });
      // };

      // if (!_.include(['selection', 'integer', 'char'], this.fields[this.group_field].type)) {
      //   throw new Error(
      //                   "Not implemented Error: type " + this.fields[this.group_field].type
      //                   + " as abscissa can't be listened. (field: " + this.group_field + ")");
      // };

      debugger;
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

      var domain =  [[this.abscissa, '=', abscissa_value], ['id','in',this.dataset.ids]];
      if (typeof(group_value) !== "undefined") {
        domain = domain.concat([[this.group_field, '=', group_value]]);
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
