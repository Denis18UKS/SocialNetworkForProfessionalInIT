using System.Text.Json;
using System.Windows.Forms;
using Renci.SshNet;

namespace SocialBIRD.VpsInstaller;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new InstallerForm());
    }
}

internal sealed class InstallerForm : Form
{
    private const string UpdateBranch = "fix/cparty-own-video-normalization-installer-20261011";
    private const string RemoteCommand = """
        set -Eeuo pipefail
        if [ "$(id -u)" -ne 0 ]; then echo "Connect with a root account." >&2; exit 1; fi
        cd /opt/socialbird/current
        AVAILABLE_BYTES="$(df -PB1 . | awk 'NR == 2 { print $4 }')"
        if [ -z "$AVAILABLE_BYTES" ] || [ "$AVAILABLE_BYTES" -lt 5368709120 ]; then
          echo "Not enough free space for a full production update. Free at least 5 GiB before continuing." >&2
          df -h / >&2
          exit 1
        fi

        echo "=== Full SocialBIRD production update ==="
        sudo -u socialbird git fetch origin +deploy/socialbird-vps-production:refs/remotes/origin/deploy/socialbird-vps-production
        sudo -u socialbird git checkout origin/deploy/socialbird-vps-production -- deploy/update-socialbird-media-playlist-unrestricted.sh
        bash deploy/update-socialbird-media-playlist-unrestricted.sh

        echo "=== Applying the C-Party own-video playback fix ==="
        sudo -u socialbird git fetch origin +fix/cparty-own-video-normalization-installer-20261011:refs/remotes/origin/fix/cparty-own-video-normalization-installer-20261011
        sudo -u socialbird git checkout origin/fix/cparty-own-video-normalization-installer-20261011 -- deploy/update-cparty-own-video-v1.sh
        bash deploy/update-cparty-own-video-v1.sh
        """;

    private readonly TextBox _host = new() { Text = "31.207.74.138", Dock = DockStyle.Fill };
    private readonly NumericUpDown _port = new() { Minimum = 1, Maximum = 65535, Value = 22, Dock = DockStyle.Left, Width = 100 };
    private readonly TextBox _username = new() { Text = "root", Dock = DockStyle.Fill };
    private readonly TextBox _password = new() { UseSystemPasswordChar = true, Dock = DockStyle.Fill };
    private readonly Button _install = new() { Text = "Подключиться и установить исправление", AutoSize = true };
    private readonly Button _forgetHost = new() { Text = "Сбросить отпечаток SSH", AutoSize = true };
    private readonly RichTextBox _log = new() { Dock = DockStyle.Fill, ReadOnly = true, Font = new System.Drawing.Font("Consolas", 9), WordWrap = false };
    private readonly string _knownHostsFile = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "SocialBIRD",
        "known-hosts.json");
    private readonly Dictionary<string, string> _knownHosts;

    public InstallerForm()
    {
        Text = "SocialBIRD — VPS AutoInstaller";
        Width = 930;
        Height = 700;
        MinimumSize = new System.Drawing.Size(760, 560);
        StartPosition = FormStartPosition.CenterScreen;
        _knownHosts = LoadKnownHosts();

        var top = new TableLayoutPanel
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            Padding = new Padding(14),
            ColumnCount = 2,
            RowCount = 6,
        };
        top.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 170));
        top.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        for (var i = 0; i < 6; i++) top.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        var note = new Label
        {
            AutoSize = true,
            Dock = DockStyle.Fill,
            Padding = new Padding(0, 0, 0, 12),
            Text = "Безопасное обновление уже установленного SocialBIRD на VPS. Программа не удаляет базу данных, аккаунты или пользовательские видео. Пароль не сохраняется и не встраивается в EXE.",
        };
        top.Controls.Add(note, 0, 0);
        top.SetColumnSpan(note, 2);
        AddRow(top, 1, "IP / hostname", _host);
        AddRow(top, 2, "SSH port", _port);
        AddRow(top, 3, "Пользователь SSH", _username);
        AddRow(top, 4, "Пароль SSH", _password);

        var buttons = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoSize = true, FlowDirection = FlowDirection.LeftToRight };
        buttons.Controls.Add(_install);
        buttons.Controls.Add(_forgetHost);
        top.Controls.Add(buttons, 1, 5);

        var logLabel = new Label { Text = "Журнал установки", AutoSize = true, Dock = DockStyle.Fill, Padding = new Padding(14, 8, 0, 5) };
        var logArea = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 2, ColumnCount = 1 };
        logArea.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        logArea.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        logArea.Controls.Add(logLabel, 0, 0);
        logArea.Controls.Add(_log, 0, 1);

        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 2, ColumnCount = 1 };
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.Controls.Add(top, 0, 0);
        layout.Controls.Add(logArea, 0, 1);
        Controls.Add(layout);

        _install.Click += async (_, _) => await RunInstallerAsync();
        _forgetHost.Click += (_, _) => ForgetHost();
        AppendLog("Готово. Укажи SSH-доступ к серверу и нажми кнопку установки.");
        AppendLog("Перед подключением сверь отпечаток SSH. После раскрытия пароля в переписке сначала смени его.");
    }

    private static void AddRow(TableLayoutPanel root, int row, string label, Control control)
    {
        var caption = new Label { Text = label, AutoSize = true, Anchor = AnchorStyles.Left, Padding = new Padding(0, 7, 12, 7) };
        control.Margin = new Padding(0, 3, 0, 3);
        root.Controls.Add(caption, 0, row);
        root.Controls.Add(control, 1, row);
    }

    private Dictionary<string, string> LoadKnownHosts()
    {
        try
        {
            if (File.Exists(_knownHostsFile))
                return JsonSerializer.Deserialize<Dictionary<string, string>>(File.ReadAllText(_knownHostsFile))
                       ?? new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        }
        catch { }
        return new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    }

    private void SaveKnownHosts()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_knownHostsFile)!);
            File.WriteAllText(_knownHostsFile, JsonSerializer.Serialize(_knownHosts, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch (Exception error)
        {
            AppendLog("Не удалось сохранить отпечаток SSH: " + error.Message);
        }
    }

    private static string HostKeyKey(string host, int port) => host.Trim().ToLowerInvariant() + ":" + port;

    private void ForgetHost()
    {
        var key = HostKeyKey(_host.Text, (int)_port.Value);
        if (_knownHosts.Remove(key))
        {
            SaveKnownHosts();
            AppendLog("Сохранённый отпечаток SSH удалён. Перед следующим подключением проверь новый отпечаток отдельно.");
        }
        else AppendLog("Для этого адреса сохранённого отпечатка нет.");
    }

    private bool CheckHostKey(byte[] fingerprint, string key)
    {
        if (InvokeRequired) return (bool)Invoke(new Func<bool>(() => CheckHostKey(fingerprint, key)));

        var formatted = BitConverter.ToString(fingerprint);
        if (_knownHosts.TryGetValue(key, out var known))
        {
            if (string.Equals(known, formatted, StringComparison.OrdinalIgnoreCase))
            {
                AppendLog("Отпечаток SSH совпал с сохранённым: " + formatted);
                return true;
            }

            MessageBox.Show(this,
                "Отпечаток SSH изменился.\n\nРанее: " + known + "\nСейчас: " + formatted + "\n\nПодключение отменено. Проверь ключ отдельно. Если переустановка сервера ожидаемая, сбрось отпечаток после проверки.",
                "Проверка SSH-ключа", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return false;
        }

        var choice = MessageBox.Show(this,
            "Это первое подключение к " + key + ".\n\nОтпечаток ключа SSH:\n" + formatted + "\n\nСверь его с отпечатком, полученным отдельно от VPS-провайдера или из доверенной консоли. Если не можешь проверить — нажми «Нет».",
            "Подтверди ключ SSH", MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
        if (choice != DialogResult.Yes) return false;
        _knownHosts[key] = formatted;
        SaveKnownHosts();
        return true;
    }

    private async Task RunInstallerAsync()
    {
        var host = _host.Text.Trim();
        var username = _username.Text.Trim();
        var password = _password.Text;
        var port = (int)_port.Value;

        if (string.IsNullOrWhiteSpace(host) || string.IsNullOrWhiteSpace(username) || string.IsNullOrEmpty(password))
        {
            MessageBox.Show(this, "Заполни IP/hostname, пользователя и пароль SSH.", "Не хватает данных", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }

        _password.Clear();
        _install.Enabled = false;
        _forgetHost.Enabled = false;
        AppendLog("");
        AppendLog("Подключаюсь к " + host + ":" + port + " под пользователем " + username + "...");
        AppendLog("Выполняется фиксированный сценарий из репозитория; пароль не записывается в журнал.");

        try
        {
            var key = HostKeyKey(host, port);
            var response = await Task.Run(() =>
            {
                var connection = new PasswordConnectionInfo(host, port, username, password)
                {
                    Timeout = TimeSpan.FromSeconds(30),
                };
                using var client = new SshClient(connection);
                client.KeepAliveInterval = TimeSpan.FromSeconds(15);
                client.HostKeyReceived += (_, e) => e.CanTrust = CheckHostKey(e.FingerPrint, key);
                client.Connect();
                AppendLog("SSH подключение установлено; запускаю updater...");
                AppendLog("Сборка frontend и проверка FFmpeg могут занять несколько минут.");
                using var command = client.CreateCommand(RemoteCommand);
                command.CommandTimeout = TimeSpan.FromMinutes(45);
                var stdout = command.Execute();
                return (stdout, command.Error, command.ExitStatus);
            });

            if (!string.IsNullOrWhiteSpace(response.stdout)) AppendLog(response.stdout);
            if (!string.IsNullOrWhiteSpace(response.Error)) AppendLog(response.Error);
            if (response.ExitStatus == 0)
            {
                AppendLog("Установка завершилась успешно.");
                MessageBox.Show(this, "Патч установлен. Обнови SocialBIRD и проверь C-Party → «Своё видео».", "SocialBIRD", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            else
            {
                AppendLog("Установка завершилась с кодом " + response.ExitStatus + ". Проверь журнал и сообщение о rollback.");
                MessageBox.Show(this, "Установка не завершилась успешно. Код: " + response.ExitStatus + ". Подробности есть в журнале.", "SocialBIRD", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
        catch (Exception error)
        {
            AppendLog("ОШИБКА: " + error.Message);
            MessageBox.Show(this, error.Message, "Не удалось выполнить установку", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally
        {
            _install.Enabled = true;
            _forgetHost.Enabled = true;
        }
    }

    private void AppendLog(string message)
    {
        if (IsDisposed) return;
        if (InvokeRequired)
        {
            BeginInvoke(new Action<string>(AppendLog), message);
            return;
        }
        _log.AppendText(message + Environment.NewLine);
        _log.SelectionStart = _log.TextLength;
        _log.ScrollToCaret();
    }
}
