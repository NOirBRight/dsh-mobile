package top.noirbright.dshmobile;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "DshBackgroundConnection",
    permissions = @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
)
public final class DshBackgroundConnectionPlugin extends Plugin {
    private final BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            notifyListeners("wake", new JSObject(), true);
        }
    };
    private boolean registered;

    @Override
    public void load() {
        IntentFilter filter = new IntentFilter(DshBackgroundConnectionService.ACTION_WAKE);
        ContextCompat.registerReceiver(getContext(), receiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED);
        registered = true;
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", false);
        if (enabled && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "notificationPermissionCallback");
            return;
        }
        Intent intent = new Intent(getContext(), DshBackgroundConnectionService.class);
        if (enabled) ContextCompat.startForegroundService(getContext(), intent);
        else getContext().stopService(intent);
        call.resolve();
    }

    @PermissionCallback
    private void notificationPermissionCallback(PluginCall call) {
        if (getPermissionState("notifications") != PermissionState.GRANTED) {
            call.reject("持续后台连接需要允许常驻通知");
            return;
        }
        setEnabled(call);
    }

    @Override
    protected void handleOnDestroy() {
        if (registered) getContext().unregisterReceiver(receiver);
        registered = false;
        super.handleOnDestroy();
    }
}
