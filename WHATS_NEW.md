# What's new since the July 22 version

This note covers what changed from a functionality point of view, for sharing
with the team. It is not a technical changelog - it describes what people can
now do that they could not before.

The single biggest change: back in July the tool was **command-line only** - you
ran it from a terminal against a workbook and got an HTML report. Since then it
has grown a **web application** that a whole team can use from a browser, while
the command-line tool is still there for automation. Everything below is grouped
by that theme.


## A browser-based application for the whole team

Previously the tool ran only from the command line. There is now a web
application people open in a browser - no install, no terminal.

- **Run tests from a browser.** Pick a project, upload or select a workbook,
  start a run, and watch each test finish live. The report opens at the end.
- **Separate project spaces.** Different teams or efforts each get their own
  space - workbooks, run history, and settings stay isolated, so one group's
  work never collides with another's.
- **Run history.** Past runs are kept and can be reopened and reviewed, rather
  than living only as a file someone saved locally.
- **Sign-in.** Access goes through the organisation's normal login, so people
  use their own credentials and the tool knows who is who.
- **The command-line tool still exists** for scheduled and automated runs, and
  produces the same report. Nothing was taken away.


## Running safely when several people use it at once

Because many people can now use it together, there is new behaviour to keep it
orderly under load.

- **A limit on how many runs happen at the same time.** An administrator sets
  the number to suit the machine. When the limit is reached, further runs wait
  in a short queue and start automatically as slots free up, instead of
  overloading the servers being tested.
- **Queue visibility.** Someone whose run is waiting sees that it is queued and
  how many are ahead of them, so nothing looks stuck.
- **Adjustable without downtime.** The limit is a setting; it can be changed and
  takes effect on the next run.


## New testing capabilities

These work in both the browser app and the command-line tool.

- **Checks at each step of a multi-step test.** A test that does several things
  in sequence - create something, update it, delete it - can now be checked
  after any individual step, not only at the very end. A value produced by one
  step (an id the server generated, say) can be used by later steps and by the
  checks.

- **Comparing a whole set of values against the database.** A test can pull a
  list of values from a response - for example every id in a list - and verify
  that exactly those rows exist in the database, as a set, regardless of order.
  Earlier only a single value could be captured and checked.

- **Test data straight from the database.** A data value no longer has to be
  typed in. A short query can look it up from the database before the test runs,
  so inputs are real and current - an account that exists today, the portfolios
  active right now - instead of a fixed value that goes stale. Queries are
  read-only for safety.

- **Using more than one database.** A test can point different lookups and checks
  at different databases by name, not just a single configured connection.

- **Optional fields are handled correctly.** If a data cell is left blank, that
  field is now left out of the request entirely rather than being sent empty -
  so optional fields no longer cause requests to fail. This already worked for
  one request format and now works consistently across formats.

- **Clearer guidance when the wrong check is used.** If a single-value database
  check is pointed at a query that returns many rows, it now says so and names
  the right check to use, instead of silently comparing against just the first
  row.


## Report and template improvements

- **The report is easier to read with large result sets.** Long lists of values
  now wrap neatly within their columns instead of stretching the table sideways.
- **The workbook template is richer.** It ships with worked examples of the new
  capabilities (per-step checks, set-based database checks, database-sourced test
  data) and dropdowns to reduce typing mistakes, plus an in-workbook guide sheet
  explaining each feature.


## Documentation

- **An architecture guide** for developers - how the system is built, how to
  extend it, and how to deploy it.
- **A workflow guide** for explaining the tool to other teams in plain language.
- Setup, deployment, and the workbook guide have all been brought up to date
  with the above.


## In one line for the team

Since July the tool went from a command-line utility to a shared, browser-based
application - with team sign-in, isolated project spaces, run history, and safe
handling of many people running at once - and gained per-step checks, set-based
and database-driven test data, multi-database support, and a clearer report.
