# Cronly sends data on stdin. All operations use the current user's token.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

function Get-DisabledScriptHostKey {
    $path = 'SOFTWARE\Microsoft\Windows Script Host\Settings'
    # Task Scheduler starts the native System32 host even when the CLI is 32-bit.
    $view = if ([Environment]::Is64BitOperatingSystem) { 'Registry64' } else { 'Registry32' }
    foreach ($hive in 'LocalMachine', 'CurrentUser') {
        $root = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $view)
        try {
            $key = $root.OpenSubKey($path)
            if ($null -ne $key) {
                try {
                    $enabled = $key.GetValue('Enabled', $null, 'DoNotExpandEnvironmentNames')
                    if ([string]$enabled -ceq '0' -and $key.GetValueKind('Enabled') -in 'DWord', 'String') {
                        return ($key.Name + '\Enabled')
                    }
                } finally { $key.Dispose() }
            }
        } finally { $root.Dispose() }
    }
}

# The scheduler canonicalizes XML (including ISO durations and default values).
# Load both definitions through the same COM serializer before comparing them.
function Get-ExecutionDefinition([string]$xml) {
    $definition = $scheduler.NewTask(0)
    $definition.XmlText = $xml
    $document = [xml]$definition.XmlText
    $ns = [Xml.XmlNamespaceManager]::new($document.NameTable)
    $ns.AddNamespace('t', $document.DocumentElement.NamespaceURI)
    foreach ($user in $document.SelectNodes('//t:UserId', $ns)) {
        if ($user.InnerText -eq $identity.Name) { $user.InnerText = $sid }
    }
    # Registered tasks can return PT23H59M30S where the input used PT1439M30S.
    foreach ($period in $document.SelectNodes('//t:Repetition/t:Interval | //t:Repetition/t:Duration | /t:Task/t:Settings/t:ExecutionTimeLimit', $ns)) {
        $period.InnerText = [Xml.XmlConvert]::ToTimeSpan($period.InnerText).Ticks.ToString()
    }
    $owned = @('t:Triggers', 't:Actions', 't:Principals',
        't:Settings/t:MultipleInstancesPolicy', 't:Settings/t:DisallowStartIfOnBatteries',
        't:Settings/t:StopIfGoingOnBatteries', 't:Settings/t:ExecutionTimeLimit')
    $parts = foreach ($path in $owned) {
        $document.SelectSingleNode("/t:Task/$path", $ns).OuterXml
    }
    return ($parts -join '')
}

try {
    $request = [Console]::In.ReadLine() | ConvertFrom-Json
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $sid = $identity.User.Value
    $prefix = 'Cronly-' + $sid + '-'
    $scheduler = New-Object -ComObject Schedule.Service
    $scheduler.Connect()
    $folder = $scheduler.GetFolder('\')
    $blockedBy = $null
    if ($request.checkScriptHost) {
        # Windows PowerShell 5.1 serializes an empty pipeline as {} in a hashtable.
        $disabledKey = Get-DisabledScriptHostKey
        if ($disabledKey) { $blockedBy = $disabledKey }
    }
    if ($request.op -eq 'list') {
        $entries = @(foreach ($task in $folder.GetTasks(1)) {
            if (!$task.Name.StartsWith($prefix)) { continue }
            $id = $task.Name.Substring($prefix.Length)
            if ($id -cnotmatch '^[0-9a-f]{8}$') { continue }
            $definition = $task.Definition
            $info = $definition.RegistrationInfo
            [PSCustomObject]@{
                id = $id
                source = $info.Source
                metadata = $info.Documentation
                xml = $task.Xml
                enabled = $task.Enabled
                result = $task.LastTaskResult
            }
        })
        [Console]::WriteLine((ConvertTo-Json -Compress -Depth 4 -InputObject @{sid=$sid; entries=$entries; blockedBy=$blockedBy}))
        [Console]::Out.Flush()
        $expected = [Console]::In.ReadToEnd() | ConvertFrom-Json
        $changed = @(foreach ($entry in $entries) {
            $property = $expected.PSObject.Properties[$entry.id]
            if ($null -eq $property) { continue }
            try {
                if ((Get-ExecutionDefinition $property.Value) -cne (Get-ExecutionDefinition $entry.xml)) { $entry.id }
            } catch { $entry.id }
        })
        [Console]::Write((ConvertTo-Json -Compress -InputObject $changed))
    } else {
        if ($request.id -cnotmatch '^[0-9a-f]{8}$') { throw 'Invalid Cronly task ID' }
        $name = $prefix + $request.id
        if ($request.op -ne 'create') {
            $existing = $folder.GetTask($name)
            if ($existing.Definition.RegistrationInfo.Source -cne 'Cronly/v1' -or $existing.Xml -cne $request.previousXml) {
                throw ('Task changed since it was read: ' + $name)
            }
        }
        switch ($request.op) {
            'create' { $null = $folder.RegisterTask($name, $request.xml, 2, $sid, $null, 3, $null) }
            'update' { $null = $folder.RegisterTask($name, $request.xml, 4, $sid, $null, 3, $null) }
            'run' {
                if ($blockedBy) { [Console]::Write($blockedBy) }
                else { $null = $existing.Run($null) }
            }
            'remove' { $folder.DeleteTask($name, 0) }
            default { throw 'Unknown Cronly task operation' }
        }
    }
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
