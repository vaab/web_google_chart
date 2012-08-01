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
            _(result).each(function (value, field) {
                if (!_(fields).contains(field)) { return; }
                if (value === false) { point[field] = false; return; }
                switch (self.fields[field].type) {
                case 'selection':
                    var select = _(self.fields[field].selection).detect(function (choice) {
                        return choice[0] === value;
                      });
                    point[field] = select[1];
                    // storing id to keep a good grouping key
                    print[field + ':id'] = select[0];
                    break;
                case 'many2one':
                    point[field] = value[1];
                    // storing id to keep a good grouping key
                    point[field + ':id'] = value[0];
                    break;
                case 'integer': case 'float': case 'char':
                case 'date': case 'datetime':
                    point[field] = value;
                    break;
                default:
                    throw new Error(
                        "Unknown field type " + self.fields[field].type
                        + "for field " + field + " (" + value + ")");
                }
            });
            return point;
        });


        if (_.include(['bar','line','area'], this.chart)) {
            return this.schedule_bar_line_area(records);
        } else if (this.chart == "pie") {
            return this.schedule_pie(records);
        }
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
        var abscissas = []; // list of different abscissas values
        var groups = [];    // list of different group values
        var groups_label = {}; // store association of id -> label for group if any
        var group_field = (records.length > 0 && 
                           records[0][self.group_field + ':id'])?self.group_field + ':id':self.group_field;
        var column = self.columns[0]; // XXXvlab: could we have multi-columns here ?
        _(records).each(function (record) {

            var abscissa = record[self.abscissa],
              group = record[group_field];

            if (!_.include(abscissas, abscissa)) abscissas.push(abscissa);
            if (!_.include(groups, group)) {
              groups.push(group);
              groups_label[group] = record[self.group_field];
            };

            if (!graph_data[abscissa])        graph_data[abscissa] = {}
            if (!graph_data[abscissa][group]) graph_data[abscissa][group] = {}

            var datapoint = graph_data[abscissa][group];

            // _(self.columns).each(function (column) {
                var val = record[column.name],
                    aggregate = datapoint[column.name];
                datapoint[column.name] = get_agg_fun(column.operator)(aggregate, val);
                return;
            // });

        });

        abscissas.sort();
        // we want to sort grouped field upon it's real label and not it's numeric id.
        groups = _(groups).sortBy(function (group) {
            return groups_label[group];
        });

        graph_data = _(abscissas).map(function(abscissa) {
            var line = graph_data[abscissa];

            return [abscissa?abscissa:"unspecified"].concat(_(groups).map(function(group) {
                  return line[group]?line[group][column.name]:get_agg_neutral(column.operator);
                }));
        });

        /* Convert to google data containuer
         *
         */

        var types = {}
        types[self.abscissa] = this.g_column_type(self.abscissa);
        var columns_title = [self.fields[self.abscissa].string];

        _(groups).each(function (group) {
            columns_title.push(groups_label[group]);
          });

        return google.visualization.arrayToDataTable([columns_title].concat(graph_data));
    },

    prepare_data_bar: function(records) {
      var self = this;
      
        // Aggregate on abscissa field, leave split on group field =>
        // max m*n records where m is the # of values for the abscissa
        // and n is the # of values for the group field
        var graph_data = [];
        var group_field = (records.length > 0 && 
                           records[0][self.group_field + ':id'])?self.group_field + ':id':self.group_field;

        _(records).each(function (record) {

            var abscissa = record[self.abscissa],
                group = record[group_field];
            var r = _(graph_data).detect(function (potential) {
                return potential[self.abscissa] === abscissa
                        && (!group_field
                            || potential[group_field] === group);
            });
            var datapoint = r || {};

            datapoint[self.abscissa] = abscissa;
            if (group_field) { 
                datapoint[group_field] = group; 
                if (self.group_field !== group_field)
                  datapoint[self.group_field] = record[self.group_field];
            }
            _(self.columns).each(function (column) {
                var val = record[column.name],
                    aggregate = datapoint[column.name];
                datapoint[column.name] = get_agg_fun(column.operator)(aggregate, val);
            });

            if (!r) { graph_data.push(datapoint); }
        });
        graph_data = _(graph_data).sortBy(function (point) {
            return point[self.abscissa] + '[[--]]' + point[self.group_field];
        });

        /* Convert to google data containuer
         *
         */
        var data = new google.visualization.DataTable();

        // ensure the abscissa is first column
        var columns = [self.abscissa].concat(_(this.columns).pluck("name"));
        if (this.group_field) { columns.push(this.group_field); }

        var types = {}
        _(columns).each(function (field) {
            var type = "string";
            var oe_type = self.fields[field].type;
            if (_.include(['integer', 'float'], oe_type))
              type = "number";
            types[field] = type;
            data.addColumn(type, self.fields[field].string);
          });

        var rows = _(graph_data).map(function(record) {
            return _(columns).map(function(field) {
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
              });
          });

        data.addRows(rows);
        return data;
    },

    schedule_bar_line_area: function(data) {

        var self = this;
        var options = {};             // google chart options associative array
        var view_chart = self.chart;  // google chart widget name

        if (self.chart == 'bar') {
          view_chart = (this.orientation === 'horizontal') ? 'bar':'column';
        }

        if (!this.group_field || !data.length) {
            data = this.prepare_data_bar(data);
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
            data = this.prepare_data_grouped_bar(data);
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

            // self.$element.find("#"+self.widget_parent.element_id+"-"+self.chart+"chart").height(
            //     self.$element.find("#"+self.widget_parent.element_id+"-"+self.chart+"chart").height()+50);
            // charts.attachEvent("onItemClick", function(id) {
            //     self.open_list_view(charts.get(id));
            // });
        };
 
        if (this.renderer) {
            clearTimeout(this.renderer);
        }

        this.renderer = setTimeout(renderer, 0);
    },

    schedule_pie: function(records) {

      var self = this;
      var options = {};

      var renderer = function () {

            if (self.$element.is(':hidden')) {
                self.renderer = setTimeout(renderer, 100);
                return;
            }

            self.renderer = null;

            data = self.prepare_data_bar(records);

            var chart = new google.visualization.PieChart(
                  document.getElementById(self.widget_parent.element_id+'-piechart'));

            chart.draw(data, options);
            // chart.attachEvent("onItemClick", function(id) {
            //     self.open_list_view(chart.get(id));
            // });
        };
        if (this.renderer) {
            clearTimeout(this.renderer);
        }
        this.renderer = setTimeout(renderer, 0);
    },

    open_list_view : function (id){
        debugger;
        var self = this;
        // unconditionally nuke tooltips before switching view
        $(".dhx_tooltip").remove('div');
        id = id[this.abscissa];
        if(this.fields[this.abscissa].type == "selection"){
            id = _.detect(this.fields[this.abscissa].selection,function(select_value){
                return _.include(select_value, id);
            });
        }
        if (typeof id == 'object'){
            id = id[0];
        }

        var views;
        if (this.widget_parent.action) {
            views = this.widget_parent.action.views;
            if (!_(views).detect(function (view) {
                    return view[1] === 'list' })) {
                views = [[false, 'list']].concat(views);
            }
        } else {
            views = _(["list", "form", "graph"]).map(function(mode) {
                return [false, mode];
            });
        }
        this.do_action({
            res_model : this.dataset.model,
            domain: [[this.abscissa, '=', id], ['id','in',this.dataset.ids]],
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
