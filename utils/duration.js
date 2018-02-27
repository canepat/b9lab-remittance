module.exports = {
    seconds: function (value) { return value; },
    minutes: function (value) { return value * this.seconds(60); },
    hours: function (value) { return value * this.minutes(60); },
    days: function (value) { return value * this.hours(24); },
    weeks: function (value) { return value * this.days(7); },
    years: function (value) { return value * this.days(365); },
};