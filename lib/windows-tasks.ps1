# Cronly sends data on stdin. All operations use the current user's token.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
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
    foreach ($period in $document.SelectNodes('//t:Repetition/t:Interval | //t:Repetition/t:Duration', $ns)) {
        $period.InnerText = [Xml.XmlConvert]::ToTimeSpan($period.InnerText).Ticks.ToString()
    }
    $parts = foreach ($name in 'Triggers', 'Actions', 'Principals') {
        $document.SelectSingleNode("/t:Task/t:$name", $ns).OuterXml
    }
    return ($parts -join '')
}

try {
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $sid = $identity.User.Value
    $prefix = 'Cronly-' + $sid + '-'
    $scheduler = New-Object -ComObject Schedule.Service
    $scheduler.Connect()
    $folder = $scheduler.GetFolder('\')
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
        [Console]::Write((ConvertTo-Json -Compress -Depth 4 -InputObject @{sid=$sid; entries=$entries}))
    } elseif ($request.op -eq 'verify') {
        $changed = @(foreach ($item in $request.definitions) {
            try {
                if ((Get-ExecutionDefinition $item.expected) -cne (Get-ExecutionDefinition $item.actual)) { $item.id }
            } catch { $item.id }
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
            'run' { $null = $existing.Run($null) }
            'remove' { $folder.DeleteTask($name, 0) }
            default { throw 'Unknown Cronly task operation' }
        }
    }
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
