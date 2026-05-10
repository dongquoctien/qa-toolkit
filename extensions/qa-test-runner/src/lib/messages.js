// Shared message constants between content / popup / service-worker.
// Loaded as a classic script from manifest content_scripts; popup imports
// via <script src="../lib/messages.js"></script>.
(function () {
  const MSG = {
    // popup ↔ content
    RECORD_START:     'qa-tr/record/start',
    RECORD_STOP:      'qa-tr/record/stop',
    RECORD_PAUSE:     'qa-tr/record/pause',
    RECORD_STATE:     'qa-tr/record/state',

    // popup ↔ content
    PLAYER_RUN:       'qa-tr/player/run',
    PLAYER_STATE:     'qa-tr/player/state',
    PLAYER_STEP:      'qa-tr/player/step-event',

    // popup ↔ background storage proxy
    SUITE_LIST:       'qa-tr/suite/list',
    SUITE_SAVE:       'qa-tr/suite/save',
    SUITE_DELETE:     'qa-tr/suite/delete',
    SUITE_IMPORT:     'qa-tr/suite/import',

    // re-check qa-annotator issues
    ISSUE_RECHECK_RUN:    'qa-tr/issue-recheck/run',
    ISSUE_RECHECK_RESULT: 'qa-tr/issue-recheck/result',

    // settings
    SETTING_GET:      'qa-tr/setting/get',
    SETTING_SET:      'qa-tr/setting/set'
  };

  const target = (typeof self !== 'undefined' ? self : window);
  target.QA = target.QA || {};
  target.QA.MSG = MSG;
})();
