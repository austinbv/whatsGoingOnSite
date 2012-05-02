(function () {
  "use strict";

  window.CalApp = {
    start: function () {
      CalApp.Router = new CalApp.AppRouter();
      Backbone.history.start();

      CalApp.Helpers.resize();

      $(window).resize(function () {
        CalApp.Helpers.resize();
      });
    },

    API_KEY: 'AIzaSyA1y3uKOlHCBg9oQmUO1XYTjBZ9M37UIu8',
    POLLING_INTERVAL: 1000 * 60 * 10
  };

  CalApp.Helpers = {
    resize: function () {
      $('#calendar').height($(window).height() - 80);
    },

    save_state: function (element) {
      var $element = $(element);
      sessionStorage.setItem('currentCalendar', $element.val());
    },

    save_state_and_login: function (element) {
      var $element = $(element);
      CalApp.Helpers.save_state(element);
      CalApp.Router.navigate('login', {trigger: true});
    }
  };

  CalApp.AppRouter = Backbone.Router.extend({
    routes: {
      'login': 'login',
      '*catchAll': 'router'
    },

    router: function () {
      if (window.location.hash.length > 0) {
        sessionStorage.setItem('accessToken', this._parseQuery().access_token.toString());
        CalApp.Router.navigate('', {trigger: true});

      } else if (sessionStorage.getItem('accessToken') && sessionStorage.getItem('accessToken').length > 0) {
        $.ajax({
          url: "https://www.googleapis.com/oauth2/v1/tokeninfo",
          data: {
            access_token: sessionStorage.getItem('accessToken')
          },
          method: 'GET',
          dataType: 'jsonp',

          error: function () {
            CalApp.Helpers.save_state_and_login($('#calendar-picker'));
          },

          success: function () {
            CalApp.header = new CalApp.Views.HeaderView();
            CalApp.currentTime = new CalApp.Views.CurrentTime();
          }
        });

      } else {
        CalApp.Helpers.save_state_and_login($('#calendar-picker'));
      }
    },

    login: function () {
      var queryString = {
        scope: 'https://www.googleapis.com/auth/calendar.readonly',
        state: 'ok',
        redirect_uri: window.location.origin + window.location.pathname,
        response_type: 'token',
        client_id: '533339277613.apps.googleusercontent.com'
      };

      window.location = 'https://accounts.google.com/o/oauth2/auth?' + $.param(queryString);
    },

    _parseQuery: function () {
      var result = {}, queryString = location.hash.substring(1),
        re = /([^&=]+)=([^&]*)/g, m;

      while (m = re.exec(queryString)) {
        result[decodeURIComponent(m[1])] = decodeURIComponent(m[2]);
      }

      return result;
    }
  });

  CalApp.Models = {
    Calendar: Backbone.Model.extend({
      parse: function (item) {
        return {
          calendarId: item.id,
          calendarName: item.summary
        };
      }
    }),

    Meeting: Backbone.Model.extend({
      defaults: {
        startTime: null,
        endTime: null,
        meetingRoom: null
      },

      validate: function (attrs) {
        if (!attrs.startTime) {
          return 'Start time must be defined';
        }
        if (!attrs.endTime) {
          return 'End time must be defined';
        }
        if (!attrs.meetingRoom) {
          return 'Meeting Room must be defined';
        }
        if (attrs.startTime > attrs.endTime) {
          return 'You cannot finish before you start!';
        }
      },

      parse: function (item) {
        return {
          title: item.summary,
          attendees: _.collect(item.attendees, function (attendee) {
            return attendee.displayName || attendee.email;
          }),
          startTime: new Date(Date.parse(item.start.dateTime || item.start.date)),
          endTime: new Date(Date.parse(item.end.dateTime || item.start.date)),
          meetingRoom: item.location
        };
      },

      startDistance: function () {
        var startTime = this.get('startTime');
        var minutesUsed = (startTime.getHours() - 8) * 60 + startTime.getMinutes();

        var percentUsed = minutesUsed / (9 * 60);
        var offset = percentUsed * $('#calendar').outerHeight();

        return offset;
      },

      calculateHeight: function () {
        var lengthOfMeetingSeconds = (this.get('endTime').getTime() - this.get('startTime').getTime()),
          lengthOfMeetingsMinutes = lengthOfMeetingSeconds / (1000 * 60);

        return  Math.floor((lengthOfMeetingsMinutes / (9 * 60)) * $('#calendar').height());
      }
    }),

    Clock: Backbone.Model.extend({
      weekDays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday',
        'Thursday', 'Friday', 'Saturday'],

      months: ['January', 'February', 'March', 'April',
        'May', 'June', 'July', 'August',
        'September', 'October', 'November', 'December'],

      initialize: function () {
        var today = new Date(), that = this;
        this._setDates();

        setInterval(function () {
          that._setDates();
        }, CalApp.POLLING_INTERVAL);
      },

      _setDates: function () {
        var date = new Date();
        this.set('second', date.getSeconds());
        this.set('minute', date.getMinutes() < 10 ? "0" + date.getMinutes() : date.getMinutes());
        this.set('hour', date.getHours() < 10 ? "0" + date.getHours() : date.getHours());
        this.set('dayOfWeek', this.weekDays[date.getDay()]);
        this.set('dayOfMonth', date.getDate());
        this.set('month', this.months[date.getMonth()]);

        return this;
      }
    })
  };

  CalApp.Collections = {
    Calendars: Backbone.Collection.extend({
      model: CalApp.Models.Calendar,

      url: function () {
        var baseUrl = 'https://www.googleapis.com/calendar/v3/users/me/calendarList?',
          data = {
            pp: 1,
            key: CalApp.API_KEY,
            access_token: sessionStorage.getItem('accessToken')
          },
          callback = "&callback=?";

        return baseUrl + $.param(data) + callback;
      },

      parse: function (calendars) {
        if (calendars.error) {
          CalApp.Helpers.save_state_and_login($('#calendar-picker'));
        }
        return calendars.items;
      }
    }),

    Meetings: Backbone.Collection.extend({
      model: CalApp.Models.Meeting,
      url: function () {
        return this._buildURL(new Date());
      },

      events: {
        'add': 'CalApp.MeetingIndex'
      },

      comparator: function (meeting) {
        return meeting.get('startTime');
      },

      parse: function (results) {
        if (results.error) {
          CalApp.Helpers.save_state_and_login($('#calendar-picker'));
        }
        return _.reject(results.items, function (item) {
          return item.status === 'cancelled';
        });
      },

      _buildURL: function (date) {
        var today = new Date(date.getFullYear(), date.getMonth(), date.getDate()),
          tomorrow = new Date(today.getTime() + (1000 * 60 * 60 * 24)),
          baseUrl = 'https://www.googleapis.com/calendar/v3/calendars',
          calendar = $('#calendar-picker').val(),
          rest = 'events',
          queryString = {
            timeMax: tomorrow.toISOString(),
            timeMin: today.toISOString(),
            pp: 100,
            key: CalApp.APIKEY,
            access_token: sessionStorage.getItem('accessToken')
          };

        return baseUrl + '/' + encodeURIComponent(calendar) + '/' + rest + '?' + $.param(queryString) + '&callback=?';
      }
    })
  };

  CalApp.Views = {
    CalendarsSelectView: Backbone.View.extend({
      el: '#calendar-picker',
      events: {
        'click #calendar-picker-wrap': 'openCalendarPicker',
        'change': 'calendarSelected'
      },

      initialize: function () {
        var that = this;
        this.collection = new CalApp.Collections.Calendars();

        this.collection.on('all', this.render, this);
        this.collection.fetch({
          success: function () {
            that.$el.trigger('change');
          },

          error: function () {
            CalApp.Helpers.save_state_and_login($('#calendar-picker'));
          }
        });

        $(window).resize(function () {
          that.$el.trigger('change');
        });
      },

      render: function () {
        var template = _.template($('#calendar-options-template').html());
        this.collection.each(function (calendar) {
          $(this.el).append(template(calendar.toJSON()));
        }, this);
        $(this.el).val(sessionStorage.getItem('currentCalendar'));

        return this;
      },

      calendarSelected: function () {
        CalApp.Helpers.save_state(this.el);
        CalApp.meetings = new CalApp.Views.MeetingView();
      },

      openCalendarPicker: function () {
        console.log('clicked')
        $(this.el).trigger('click');
      }
    }),

    MeetingView: Backbone.View.extend({
      el: '#calendar',

      initialize: function () {
        var that = this;
        this.collection = new CalApp.Collections.Meetings();

        this.collection.on('all', this.render, this);
        this.collection.fetch({
          error: function () {
            CalApp.Helpers.save_state_and_login($('#calendar-picker'));
          }
        });

        setInterval(function () {
          that.collection.fetch();
          that.render();
        }, CalApp.POLLING_INTERVAL);
      },

      render: function () {
        var template = _.template($('#meeting-template').html());

        $('.meeting').remove();
        this.collection.each(function (meeting) {
          $(this.el).append(template(meeting.toJSON()));
          $(this.el).children('.meeting:last').css({
            position: 'absolute',
            top: (meeting.startDistance()) + 'px',
            height: meeting.calculateHeight() + 'px'
          });
        }, this);
        return this;
      }
    }),

    HeaderView: Backbone.View.extend({
      el: '#header',

      initialize: function () {
        this.model = new CalApp.Models.Clock();
        this.model.on('all', this.render, this);
        this.render();
        this.views = [new CalApp.Views.CalendarsSelectView()];
      },

      render: function () {
        var template = _.template($('#header-template').html());
        $(this.el).html(template(this.model.toJSON()));
        this._setFontSize();
        return this;
      },

      _setFontSize: function () {
        $('#date, #calendar-picker').css({fontSize: $('#date').innerHeight()});
      }
    }),

    CurrentTime: Backbone.View.extend({
      el: '#current-time-wrapper',

      initialize: function () {
        this.model = new CalApp.Models.Clock();

        this.model.on('all', this.render, this);
        this.render();
      },

      render: function () {
        var template = _.template($('#current-time').html());
        $(this.el).html(template({offset: this.calculateOffset()}));

        return this;
      },

      calculateOffset: function () {
        var secondsIntoTheDay = ((this.model.get('hour') - 8) * 60 * 60) + (this.model.get('minute') * 60) + (this.model.get('second'));
//        var secondsIntoTheDay = ((8 - 8) * 60 * 60) + (20 * 60) + (30);

        var amountOfDayUsed = secondsIntoTheDay / (60 * 60 * 9);
        return $('#calendar').height() * amountOfDayUsed;
      }
    })
  };
})();