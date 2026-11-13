'use strict';

/**
 * The Android half of Notes reminders: an alarm that rings at the set time
 * with the app closed, and a hand-off to the phone's calendar.
 *
 * Generated into the Capacitor project beside MainActivity (android/ is
 * gitignored and recreated in CI). Only platform classes are used, so no new
 * dependency reaches the build.
 *
 * The alarm goes to AlarmManager.setAlarmClock — the call the clock app
 * itself uses. It rings on time even in Doze, shows in the system's "next
 * alarm", and needs no special permission. The alarms are also kept in
 * SharedPreferences, because a reboot clears every scheduled alarm; the boot
 * receiver puts them back.
 */

const PKG = 'cloud.tsogs.tankmanagement';

const SCHEDULER = `package ${PKG};

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

/** Keeps the alarms the Notes page asked for, and hands them to the system clock. */
final class ReminderScheduler {
  static final String PREFS = "cheng_reminders";
  static final String KEY = "alarms";
  static final String CHANNEL = "cheng_alarm_v1";

  private ReminderScheduler() {}

  private static PendingIntent operation(Context ctx, JSONObject a, int flags) throws Exception {
    String id = a.getString("id");
    Intent intent = new Intent(ctx, ReminderReceiver.class);
    intent.setData(Uri.parse("cheng-reminder://" + Uri.encode(id)));
    intent.putExtra("id", id);
    intent.putExtra("title", a.optString("title", "Note"));
    intent.putExtra("body", a.optString("body", ""));
    intent.putExtra("deadlineAt", a.optLong("deadlineAt", 0L));
    int f = flags;
    if (Build.VERSION.SDK_INT >= 23) f |= PendingIntent.FLAG_IMMUTABLE;
    return PendingIntent.getBroadcast(ctx, id.hashCode(), intent, f);
  }

  private static PendingIntent showApp(Context ctx) {
    Intent open = new Intent(ctx, MainActivity.class);
    open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    int f = PendingIntent.FLAG_UPDATE_CURRENT;
    if (Build.VERSION.SDK_INT >= 23) f |= PendingIntent.FLAG_IMMUTABLE;
    return PendingIntent.getActivity(ctx, 0, open, f);
  }

  private static JSONArray stored(Context ctx) {
    try {
      return new JSONArray(prefs(ctx).getString(KEY, "[]"));
    } catch (Exception e) {
      return new JSONArray();
    }
  }

  private static SharedPreferences prefs(Context ctx) {
    return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
  }

  private static void cancel(Context ctx, JSONArray list) {
    AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
    if (am == null) return;
    for (int i = 0; i < list.length(); i++) {
      try {
        am.cancel(operation(ctx, list.getJSONObject(i), PendingIntent.FLAG_UPDATE_CURRENT));
      } catch (Exception ignored) {
      }
    }
  }

  private static void arm(Context ctx, JSONArray list) {
    AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
    if (am == null) return;
    long now = System.currentTimeMillis();
    for (int i = 0; i < list.length(); i++) {
      try {
        JSONObject a = list.getJSONObject(i);
        long at = a.getLong("fireAt");
        if (at <= now) continue;
        am.setAlarmClock(new AlarmManager.AlarmClockInfo(at, showApp(ctx)),
            operation(ctx, a, PendingIntent.FLAG_UPDATE_CURRENT));
      } catch (Exception ignored) {
      }
    }
  }

  /** The page sends the complete set each time: what is not in it is cancelled. */
  static void replaceAll(Context ctx, String json) {
    JSONArray next;
    try {
      next = new JSONArray(json == null ? "[]" : json);
    } catch (Exception e) {
      return;
    }
    cancel(ctx, stored(ctx));
    prefs(ctx).edit().putString(KEY, next.toString()).apply();
    arm(ctx, next);
  }

  /** After a reboot or an app update the system has forgotten them all. */
  static void restore(Context ctx) {
    arm(ctx, stored(ctx));
  }

  /** An alarm that has rung is not kept, so it is not set again on the next boot. */
  static void forget(Context ctx, String id) {
    JSONArray old = stored(ctx);
    JSONArray keep = new JSONArray();
    for (int i = 0; i < old.length(); i++) {
      JSONObject a = old.optJSONObject(i);
      if (a != null && !id.equals(a.optString("id"))) keep.put(a);
    }
    prefs(ctx).edit().putString(KEY, keep.toString()).apply();
  }
}
`;

const RECEIVER = `package ${PKG};

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

import java.text.DateFormat;
import java.util.Date;

/** Rings when the system clock fires a note's alarm. */
public class ReminderReceiver extends BroadcastReceiver {
  @Override
  public void onReceive(Context ctx, Intent intent) {
    String id = intent.getStringExtra("id");
    String title = intent.getStringExtra("title");
    String body = intent.getStringExtra("body");
    long deadlineAt = intent.getLongExtra("deadlineAt", 0L);
    if (id == null) return;
    if (title == null || title.isEmpty()) title = "Note";

    NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
    if (nm == null) return;
    Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
    if (sound == null) sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);

    Notification.Builder b;
    if (Build.VERSION.SDK_INT >= 26) {
      if (nm.getNotificationChannel(ReminderScheduler.CHANNEL) == null) {
        NotificationChannel ch = new NotificationChannel(
            ReminderScheduler.CHANNEL, "Note alarms", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Alarms set on a note's deadline");
        ch.setSound(sound, new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build());
        ch.enableVibration(true);
        ch.setVibrationPattern(new long[] {0, 600, 300, 600, 300, 600});
        nm.createNotificationChannel(ch);
      }
      b = new Notification.Builder(ctx, ReminderScheduler.CHANNEL);
    } else {
      b = new Notification.Builder(ctx);
      b.setSound(sound, AudioManagerStream.ALARM);
      b.setVibrate(new long[] {0, 600, 300, 600, 300, 600});
      b.setPriority(Notification.PRIORITY_HIGH);
    }

    String text = body == null ? "" : body;
    if (deadlineAt > 0) {
      String when = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(new Date(deadlineAt));
      text = text.isEmpty() ? when : when + " — " + text;
    }
    Intent open = new Intent(ctx, MainActivity.class);
    open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    int flags = PendingIntent.FLAG_UPDATE_CURRENT;
    if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
    PendingIntent tap = PendingIntent.getActivity(ctx, id.hashCode(), open, flags);

    b.setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
        .setContentTitle(title)
        .setContentText(text)
        .setStyle(new Notification.BigTextStyle().bigText(text))
        .setCategory(Notification.CATEGORY_ALARM)
        .setContentIntent(tap)
        .setAutoCancel(true)
        .setWhen(System.currentTimeMillis());
    Notification n = b.build();
    /* Keep sounding until it is dealt with, as an alarm does. */
    n.flags |= Notification.FLAG_INSISTENT;
    nm.notify(id.hashCode(), n);
    ReminderScheduler.forget(ctx, id);
  }

  /** android.media.AudioManager.STREAM_ALARM, named for what it is here. */
  private static final class AudioManagerStream {
    static final int ALARM = android.media.AudioManager.STREAM_ALARM;
  }
}
`;

const BOOT = `package ${PKG};

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Alarms do not survive a reboot or an app update; put them back. */
public class ReminderBootReceiver extends BroadcastReceiver {
  @Override
  public void onReceive(Context ctx, Intent intent) {
    ReminderScheduler.restore(ctx.getApplicationContext());
  }
}
`;

const BRIDGE = `package ${PKG};

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.CalendarContract;
import android.webkit.JavascriptInterface;

import java.util.TimeZone;

/**
 * What the Notes page can ask of the phone: keep these alarms, and keep this
 * note's event in the calendar. The page is the only caller.
 *
 * A note's calendar event is written straight into the calendar and remembered
 * against the note's id, so editing the note changes that same event instead of
 * leaving the old one behind and opening a screen to add another.
 */
public class ReminderBridge {
  private static final int NOTIFY_REQUEST = 4711;
  private static final int CALENDAR_REQUEST = 4712;
  private static final String CAL_PREFS = "cheng_calendar_events";
  private final Activity activity;

  ReminderBridge(Activity activity) {
    this.activity = activity;
  }

  /** Replace every alarm with this JSON list; returns whether it was accepted. */
  @JavascriptInterface
  public boolean sync(String json) {
    try {
      ReminderScheduler.replaceAll(activity.getApplicationContext(), json);
      askToNotify();
      return true;
    } catch (Exception e) {
      return false;
    }
  }

  /** "granted" once the calendar can be read and written. */
  @JavascriptInterface
  public String calendarPermission() {
    if (Build.VERSION.SDK_INT < 23) return "granted";
    boolean read = activity.checkSelfPermission("android.permission.READ_CALENDAR") == PackageManager.PERMISSION_GRANTED;
    boolean write = activity.checkSelfPermission("android.permission.WRITE_CALENDAR") == PackageManager.PERMISSION_GRANTED;
    return read && write ? "granted" : "denied";
  }

  /** Asks the user once; the page polls calendarPermission() for the answer. */
  @JavascriptInterface
  public void requestCalendarPermission() {
    if (Build.VERSION.SDK_INT < 23) return;
    activity.runOnUiThread(() -> activity.requestPermissions(
        new String[] {"android.permission.READ_CALENDAR", "android.permission.WRITE_CALENDAR"}, CALENDAR_REQUEST));
  }

  /**
   * Puts the note in the calendar, or brings its event up to date. Returns
   * "ok:inserted", "ok:updated", "denied" (no permission), "nocalendar" (no
   * writable calendar on the device) or "error:...".
   */
  @JavascriptInterface
  public String upsertCalendarEvent(String noteId, String title, String description,
                                    double startMs, double durationMin, double leadMin) {
    try {
      if (!"granted".equals(calendarPermission())) return "denied";
      if (noteId == null || noteId.isEmpty()) return "error:no id";
      ContentResolver cr = activity.getContentResolver();
      long start = (long) startMs;
      long end = start + (long) (durationMin * 60000d);
      SharedPreferences prefs = activity.getSharedPreferences(CAL_PREFS, Context.MODE_PRIVATE);
      long eventId = prefs.getLong(noteId, -1L);
      boolean exists = eventId >= 0 && eventExists(cr, eventId);

      ContentValues v = new ContentValues();
      v.put(CalendarContract.Events.TITLE, title);
      v.put(CalendarContract.Events.DESCRIPTION, description);
      v.put(CalendarContract.Events.DTSTART, start);
      v.put(CalendarContract.Events.DTEND, end);
      v.put(CalendarContract.Events.EVENT_TIMEZONE, TimeZone.getDefault().getID());
      v.put(CalendarContract.Events.HAS_ALARM, 1);

      if (exists) {
        cr.update(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, eventId), v, null, null);
        replaceReminder(cr, eventId, (int) leadMin);
        return "ok:updated";
      }
      long calendarId = writableCalendarId(cr);
      if (calendarId < 0) return "nocalendar";
      v.put(CalendarContract.Events.CALENDAR_ID, calendarId);
      Uri created = cr.insert(CalendarContract.Events.CONTENT_URI, v);
      if (created == null) return "error:the calendar refused the event";
      eventId = ContentUris.parseId(created);
      prefs.edit().putLong(noteId, eventId).apply();
      replaceReminder(cr, eventId, (int) leadMin);
      return "ok:inserted";
    } catch (Exception e) {
      return "error:" + e.getMessage();
    }
  }

  /** Takes the note's event out of the calendar. "ok", "none" (it had none) or "denied". */
  @JavascriptInterface
  public String removeCalendarEvent(String noteId) {
    try {
      SharedPreferences prefs = activity.getSharedPreferences(CAL_PREFS, Context.MODE_PRIVATE);
      long eventId = prefs.getLong(noteId, -1L);
      if (eventId < 0) return "none";
      if (!"granted".equals(calendarPermission())) return "denied";
      activity.getContentResolver().delete(
          ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, eventId), null, null);
      prefs.edit().remove(noteId).apply();
      return "ok";
    } catch (Exception e) {
      return "error:" + e.getMessage();
    }
  }

  /**
   * Opens the calendar's new-event screen, filled in, for a phone where the
   * calendar permission was refused. The user saves it there.
   */
  @JavascriptInterface
  public boolean addToCalendar(String title, String description, double startMs, double durationMin, double leadMin) {
    try {
      final long start = (long) startMs;
      final long end = start + (long) (durationMin * 60000d);
      final Intent intent = new Intent(Intent.ACTION_INSERT)
          .setData(CalendarContract.Events.CONTENT_URI)
          .putExtra(CalendarContract.Events.TITLE, title)
          .putExtra(CalendarContract.Events.DESCRIPTION, description)
          .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, start)
          .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, end);
      activity.runOnUiThread(() -> {
        try {
          activity.startActivity(intent);
        } catch (Exception ignored) {
          /* No calendar app installed. */
        }
      });
      return intent.resolveActivity(activity.getPackageManager()) != null;
    } catch (Exception e) {
      return false;
    }
  }

  private boolean eventExists(ContentResolver cr, long eventId) {
    Cursor c = null;
    try {
      c = cr.query(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, eventId),
          new String[] {CalendarContract.Events._ID, CalendarContract.Events.DELETED}, null, null, null);
      return c != null && c.moveToFirst() && c.getInt(1) == 0;
    } catch (Exception e) {
      return false;
    } finally {
      if (c != null) c.close();
    }
  }

  /** The calendar to put events in: one the user can write to, their own account's first. */
  private long writableCalendarId(ContentResolver cr) {
    Cursor c = null;
    try {
      c = cr.query(CalendarContract.Calendars.CONTENT_URI,
          new String[] {CalendarContract.Calendars._ID, CalendarContract.Calendars.ACCOUNT_TYPE,
              CalendarContract.Calendars.ACCOUNT_NAME, CalendarContract.Calendars.OWNER_ACCOUNT},
          CalendarContract.Calendars.VISIBLE + "=1 AND "
              + CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL + ">=" + CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR,
          null, null);
      long best = -1;
      int bestScore = -1;
      while (c != null && c.moveToNext()) {
        int score = 0;
        String type = c.getString(1);
        String account = c.getString(2);
        String owner = c.getString(3);
        if (account != null && account.equals(owner)) score += 4;
        if (type != null && !CalendarContract.ACCOUNT_TYPE_LOCAL.equals(type)) score += 2;
        if (score > bestScore) {
          bestScore = score;
          best = c.getLong(0);
        }
      }
      return best;
    } catch (Exception e) {
      return -1;
    } finally {
      if (c != null) c.close();
    }
  }

  /** One alert, at the lead the note asked for, in place of whatever the event had. */
  private void replaceReminder(ContentResolver cr, long eventId, int leadMin) {
    try {
      cr.delete(CalendarContract.Reminders.CONTENT_URI,
          CalendarContract.Reminders.EVENT_ID + "=?", new String[] {String.valueOf(eventId)});
      ContentValues r = new ContentValues();
      r.put(CalendarContract.Reminders.EVENT_ID, eventId);
      r.put(CalendarContract.Reminders.MINUTES, Math.max(0, leadMin));
      r.put(CalendarContract.Reminders.METHOD, CalendarContract.Reminders.METHOD_ALERT);
      cr.insert(CalendarContract.Reminders.CONTENT_URI, r);
    } catch (Exception ignored) {
      /* The event is in; only its alert is missing. */
    }
  }

  /** From Android 13 a notification, and so the alarm's ring, needs the user's yes. */
  private void askToNotify() {
    if (Build.VERSION.SDK_INT < 33) return;
    if (activity.checkSelfPermission("android.permission.POST_NOTIFICATIONS")
        == PackageManager.PERMISSION_GRANTED) return;
    activity.runOnUiThread(() -> activity.requestPermissions(
        new String[] {"android.permission.POST_NOTIFICATIONS"}, NOTIFY_REQUEST));
  }
}
`;


const SPEECH = `package ${PKG};

import android.app.Activity;
import android.content.Context;
import android.media.AudioAttributes;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * The Android WebView does not speak. Chrome's speechSynthesis is there in a
 * browser, but inside this app it either does not exist or has no voices, so
 * the bunkering warning was a horn and nothing else. The tablet's own
 * text-to-speech engine (Samsung's or Google's) is reached here instead.
 *
 * It prefers a voice stored on the device: one that has to be fetched from a
 * server says nothing at sea. The page is told when the order has been spoken
 * (the event cheng-tts) so the horn can come back up.
 */
public class SpeechBridge {
  private final WebView web;
  private TextToSpeech tts;
  private volatile String state = "starting";
  private final List<Runnable> waiting = new ArrayList<>();

  SpeechBridge(Activity activity, WebView web) {
    this.web = web;
    try {
      tts = new TextToSpeech(activity.getApplicationContext(), status -> {
        if (status != TextToSpeech.SUCCESS) {
          state = "unavailable";
          return;
        }
        configure();
        state = "ready";
        List<Runnable> run;
        synchronized (waiting) {
          run = new ArrayList<>(waiting);
          waiting.clear();
        }
        for (Runnable r : run) r.run();
      });
    } catch (Exception e) {
      state = "unavailable";
    }
  }

  private void configure() {
    try {
      tts.setAudioAttributes(new AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build());
      Voice best = null;
      int bestScore = Integer.MIN_VALUE;
      Set<Voice> voices = tts.getVoices();
      if (voices != null) {
        for (Voice v : voices) {
          Locale l = v.getLocale();
          if (l == null || !"en".equalsIgnoreCase(l.getLanguage())) continue;
          if (v.isNetworkConnectionRequired()) continue;
          if (v.getFeatures() != null && v.getFeatures().contains("notInstalled")) continue;
          int score = v.getQuality();
          if ("GB".equalsIgnoreCase(l.getCountry())) score += 50;
          if (score > bestScore) {
            bestScore = score;
            best = v;
          }
        }
      }
      if (best != null) {
        tts.setVoice(best);
      } else if (tts.isLanguageAvailable(Locale.UK) >= TextToSpeech.LANG_AVAILABLE) {
        tts.setLanguage(Locale.UK);
      } else {
        tts.setLanguage(Locale.US);
      }
      tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
        @Override public void onStart(String id) {}
        @Override public void onDone(String id) { finished(id, "done"); }
        @Override public void onError(String id) { finished(id, "error"); }
      });
    } catch (Exception ignored) {
      /* the default voice still speaks */
    }
  }

  private void finished(String id, String how) {
    if (id == null || !id.endsWith(":last") || web == null) return;
    web.post(() -> web.evaluateJavascript(
        "try{window.dispatchEvent(new CustomEvent('cheng-tts',{detail:{state:'" + how + "'}}));}catch(e){}", null));
  }

  /** "ready", "starting" (the engine is still binding) or "unavailable" (no engine). */
  @JavascriptInterface
  public String status() {
    return state;
  }

  /**
   * Speaks the phrases in order, a short pause between them. Returns false
   * when this device has no speech engine, so the page can try another way.
   */
  @JavascriptInterface
  public boolean speak(final String phrasesJoined, final float rate, final float pitch) {
    if ("unavailable".equals(state) || tts == null) return false;
    final Runnable go = () -> {
      try {
        tts.stop();
        tts.setSpeechRate(rate > 0 ? rate : 0.9f);
        tts.setPitch(pitch > 0 ? pitch : 0.9f);
        String[] parts = phrasesJoined == null ? new String[0] : phrasesJoined.split("\\\\|");
        String stamp = String.valueOf(System.nanoTime());
        for (int i = 0; i < parts.length; i++) {
          boolean last = i == parts.length - 1;
          Bundle params = new Bundle();
          params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, 1f);
          tts.speak(parts[i], TextToSpeech.QUEUE_ADD, params, stamp + ":" + i + (last ? ":last" : ""));
          if (!last) tts.playSilentUtterance(220, TextToSpeech.QUEUE_ADD, stamp + ":gap" + i);
        }
      } catch (Exception ignored) {
      }
    };
    if ("starting".equals(state)) {
      synchronized (waiting) { waiting.add(go); }
    } else {
      go.run();
    }
    return true;
  }

  @JavascriptInterface
  public void stop() {
    try { if (tts != null) tts.stop(); } catch (Exception ignored) { }
  }
}
`;

/** Manifest additions: permissions, and the two receivers. */
const PERMISSIONS = [
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.RECEIVE_BOOT_COMPLETED',
  'android.permission.VIBRATE',
  'android.permission.READ_CALENDAR',
  'android.permission.WRITE_CALENDAR',
];

const RECEIVERS = `
        <receiver android:name=".ReminderReceiver" android:exported="false" />
        <receiver android:name=".ReminderBootReceiver" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.BOOT_COMPLETED" />
                <action android:name="android.intent.action.MY_PACKAGE_REPLACED" />
            </intent-filter>
        </receiver>
`;

module.exports = {
  PKG,
  files: {
    'ReminderScheduler.java': SCHEDULER,
    'ReminderReceiver.java': RECEIVER,
    'ReminderBootReceiver.java': BOOT,
    'ReminderBridge.java': BRIDGE,
    'SpeechBridge.java': SPEECH,
  },
  PERMISSIONS,
  RECEIVERS,
};
