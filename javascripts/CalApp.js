window.CalApp = {
  start:function () {
    CalApp.Router = new CalApp.AppRouter();
    Backbone.history.start();
  },

  API_KEY:'AIzaSyA1y3uKOlHCBg9oQmUO1XYTjBZ9M37UIu8'
};

CalApp.AppRouter = Backbone.Router.extend({
  routes:{
    'state':'retouter',
    'login':'login',
    '*catchAll':'rerouter'

  },

  rerouter:function () {
    if (window.location.hash.length > 0) {
      sessionStorage.setItem('accessToken', this._parseQuery()['access_token'].toString());
      CalApp.Router.navigate('', {trigger:true})
    } else if (sessionStorage.getItem('accessToken') && sessionStorage.getItem('accessToken').length > 0) {
      $.ajax({
        url:"https://www.googleapis.com/oauth2/v1/tokeninfo",
        data:{
          access_token:sessionStorage.getItem('accessToken'),
        },
        method:'GET',
        dataType:'jsonp',

        error:function () {
          CalApp.Router.navigate('login', {trigger:true})
        },

        success:function () {
          new CalApp.Views.HeaderView();
          new CalApp.Views.CurrentTime();
        }
      });

    } else {
      CalApp.Router.navigate('login', {trigger:true})
    }
  },

  login:function () {
    var queryString = {
      scope:'https://www.googleapis.com/auth/calendar.readonly',
      state:'ok',
      redirect_uri:'http://localhost',
      response_type:'token',
      client_id:'533339277613.apps.googleusercontent.com'
    };

    window.location = 'https://accounts.google.com/o/oauth2/auth?' + $.param(queryString)
  },

  googleAuth:function () {

  },

  _parseQuery:function () {
    var result = {}, queryString = location.hash.substring(1),
      re = /([^&=]+)=([^&]*)/g, m;

    while (m = re.exec(queryString)) {
      result[decodeURIComponent(m[1])] = decodeURIComponent(m[2]);
    }

    return result;
  }
}),

  CalApp.Models = {
    Calendar:Backbone.Model.extend({
      parse:function (item) {
        return {
          calendarId:item.id,
          calendarName:item.summary
        }
      }
    }),

    Meeting:Backbone.Model.extend({
      defaults:{
        startTime:null,
        endTime:null,
        meetingRoom:null
      },

      validate:function (attrs) {
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

      parse:function (item) {
        return {
          title:item.summary,
          attendees:_.collect(item.attendees, function (attendee) {
            return attendee.displayName || attendee.email;
          }),
          startTime:new Date(Date.parse(item.start.dateTime || item.start.date)),
          endTime:new Date(Date.parse(item.end.dateTime || item.start.date)),
          meetingRoom:item.location
        }
      },

      startDistance:function () {
        var startTime = this.get('startTime');
        var minutesUsed = (startTime.getHours() - 8) * 60 + startTime.getMinutes();

        var percentUsed = minutesUsed / (9.0 * 60);
        var offset = percentUsed * $('body').width();

        return offset;
      },

      calculateWidth:function () {
        var lengthOfMeetingSeconds = (this.get('endTime').getTime() - this.get('startTime').getTime()),
          lengthOfMeetingsMinutes = lengthOfMeetingSeconds / (1000 * 60);
        return  (lengthOfMeetingsMinutes / (9 * 60)) * $('body').width();
      }
    }),

    Clock:Backbone.Model.extend({
      weekDays:['Sunday', 'Monday', 'Tuesday', 'Wednesday',
        'Thursday', 'Friday', 'Saturday'],

      months:['January', 'February', 'March', 'April',
        'May', 'June', 'July', 'August',
        'September', 'October', 'November', 'December'],

      initialize:function () {
        var today = new Date(), that = this;
        this._setDates();

        setInterval(function () {
          that._setDates();
        }, 1000)
      },

      _setDates:function () {
        var date = new Date();
        this.set('second', date.getSeconds());
        this.set('minute', date.getMinutes() < 10 ? "0" + date.getMinutes() : date.getMinutes());
        this.set('hour', date.getHours() < 10 ? "0" + date.getHours() : date.getHours());
        this.set('dayOfWeek', this.weekDays[date.getDay()]);
        this.set('dayOfMonth', date.getDate());
        this.set('month', this.months[date.getMonth()]);

        return this
      }
    })
  };

CalApp.Collections = {
  Calendars:Backbone.Collection.extend({
    model:CalApp.Models.Calendar,
    url:function () {
      var baseUrl = 'https://www.googleapis.com/calendar/v3/users/me/calendarList?',
        data = {
          pp:1,
          key:CalApp.API_KEY,
          access_token:sessionStorage.getItem('accessToken')
        },
        callback = "&callback=?"

      return baseUrl + $.param(data) + callback
    },

    parse:function (calendars) {
      if (calendars.error) {
        CalApp.Router.navigate('login', {trigger: true});
      }
      return calendars.items
    }
  }),

  Meetings:Backbone.Collection.extend({
    model:CalApp.Models.Meeting,
    url:function () {
      return this._buildURL(new Date());
    },

    events:{
      'add':'CalApp.MeetingIndex'
    },

    comparator:function (meeting) {
      return meeting.get('startTime');
    },

    parse:function (results) {

      if (results.error) {
        CalApp.Router.navigate('login', {trigger: true});
      }
      return _.reject(results.items, function (item) {
        return item.status == 'cancelled'
      });
    },

    _buildURL:function (date) {
      var today = new Date(date.getFullYear(), date.getMonth(), date.getDate()),
        tomorrow = new Date(today.getTime() + (1000 * 60 * 60 * 24)),
        baseUrl = 'https://www.googleapis.com/calendar/v3/calendars',
        calendar = $('#calendar-picker').val(),
        rest = 'events',
        queryString = {
          timeMax:tomorrow.toISOString(),
          timeMin:today.toISOString(),
          pp:100,
          key:CalApp.APIKEY,
          access_token:sessionStorage.getItem('accessToken')
        }

      return baseUrl + '/' + calendar + '/' + rest + '?' + $.param(queryString) + '&callback=?';
    }
  })
}
CalApp.Views = {
  CalendarsSelectView:Backbone.View.extend({
    el: '#calendar-picker',
    events: {
      'change': 'renderMeetings'
    },
    initialize:function () {
      this.collection = new CalApp.Collections.Calendars();

      this.collection.on('all', this.render, this);
      this.collection.fetch({
        error:function () {
          CalApp.Router.navigate('login', {trigger:true})
        }
      });
    },

    render:function () {
      var template = _.template($('#calendar-options-template').html());
      this.collection.each(function (calendar) {
        $(this.el).append(template(calendar.toJSON()));
      }, this);

      this
    },

    renderMeetings: function(calendar) {
      CalApp.meetings = new CalApp.Views.MeetingView();

    }
  }),

  MeetingView:Backbone.View.extend({
    el:'#calendar',

    initialize:function () {
      var that = this;
      this.collection = new CalApp.Collections.Meetings();

      this.collection.on('all', this.render, this);
      this.collection.fetch({
        error:function () {
          CalApp.Router.navigate('login', {trigger:true});
        }
      });
      this.render();

      setInterval(function () {
        that.collection.fetch();
          that.render();
      }, 1000);
    },

    render:function () {
      var template = _.template($('#meeting-template').html());

      $('.event').remove();
      this.collection.each(function (meeting) {
        $(this.el).append(template(meeting.toJSON()));
        $(this.el).children('.event:last').css({
          position:'absolute',
          height:'60%',
          top:'10%',
          left:meeting.startDistance() + 'px',
          width:meeting.calculateWidth() + 'px'
        });
      }, this);
      return this;
    }
  }),

  HeaderView:Backbone.View.extend({
    el:'#header',

    initialize:function () {
      this.model = new CalApp.Models.Clock();
      this.model.on('all', this.render, this);
      this.render();
      new CalApp.Views.CalendarsSelectView();
    },

    render:function () {
      var template = _.template($('#header-template').html());
      $(this.el).html(template(this.model.toJSON()));
      this._setFontSize();
      return this;
    },

    _setFontSize:function () {
      $('#date').css({fontSize:$('#date').innerHeight()});
    }
  }),

  CurrentTime:Backbone.View.extend({
    el:'#current-time-wrapper',

    initialize:function () {
      this.model = new CalApp.Models.Clock();

      this.model.on('all', this.render, this);
      this.render();
    },

    render:function () {
      var template = _.template($('#current-time').html());
      $(this.el).html(template({offset:this.calculateOffset()}));

      return this;
    },

    calculateOffset:function () {
      var secondsIntoTheDay = ((this.model.get('hour') - 8) * 60 * 60) + (this.model.get('minute') * 60) + (this.model.get('second'));

      var amountOfDayUsed = secondsIntoTheDay / (60 * 60 * 9)
      return $('body').width() * amountOfDayUsed
    }
  })
};