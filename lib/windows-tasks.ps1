# Cronly sends data on stdin. All operations use the current user's token.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
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
            'remove' { $folder.DeleteTask($name, 0) }
            default { throw 'Unknown Cronly task operation' }
        }
    }
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
