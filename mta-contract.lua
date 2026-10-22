-- Execute from the resources directory using Lua or the local Fengari CLI.
local events, requests, notifications, timers = {}, {}, {}, {}
local ticks = 10000
local decoded
root, resourceRoot, client = {}, {}, {}
JBLMusicConfig = {backend="https://own.example/",apiKey="private-server-key-12345"}
function addEvent() end
function addEventHandler(name, _, callback) events[name]=callback end
function getJBLObject() return client end
function isElement(value) return type(value)=="table" end
function getTickCount() return ticks end
function triggerClientEvent(...) notifications[#notifications+1]={...} end
function fetchRemote(url,options,callback) requests[#requests+1]={url=url,options=options,callback=callback} end
function fromJSON() return decoded end
function isTimer(value) return value and value.active end
function killTimer(value) value.active=false end
function setTimer(callback,delay,repeats)
    local timer={active=true,delay=delay,callback=callback}
    timers[#timers+1]=timer
    return timer
end
unpack = unpack or table.unpack
dofile('spotifySirilo/music_server.lua')
events['jbl:search']('una cancion')
assert(requests[1].url=='https://own.example/search?limit=8&q=una%20cancion')
assert(requests[1].options.headers['X-API-Key']=='private-server-key-12345')
decoded={results={{url='https://www.youtube.com/watch?v=abcdefghijk',title='Prueba',duration='3:00'}}}
requests[1].callback('json',{success=true})
events['jbl:play']('abcdefghijk')
assert(requests[2].url:find('/stream?format=webm&url=',1,true))
assert(requests[2].options.headers['X-API-Key']=='private-server-key-12345')
decoded={stream_url='https://own.example/audio?ticket=signature',duration_ms=180000}
requests[2].callback('json',{success=true})
assert(#timers==1 and timers[1].active)
local playing=notifications[#notifications]
assert(playing[2]=='jbl:state' and playing[5].paused==false)
assert(playing[5].apiKey==nil)
ticks=ticks+5000
events['jbl:pause']()
assert(#timers==1 and not timers[1].active,'paused track must not expire')
ticks=ticks+5000
events['jbl:pause']()
assert(#timers==2 and timers[2].active and timers[2].delay==178000,'resume schedules remaining time')
ticks=ticks+5000
events['jbl:search']('otra cancion')
decoded={detail='Clave de backend incorrecta.'}
requests[3].callback('json',{success=false})
assert(notifications[#notifications][4]=='Clave de backend incorrecta.')
ticks=ticks+5000
events['jbl:play']('abcdefghijk')
local obsolete = requests[4]
jblMusicStop(client)
ticks=ticks+5000
events['jbl:search']('nueva sesion')
decoded={results={{url='https://www.youtube.com/watch?v=abcdefghijk',title='Nueva',duration='3:00'}}}
requests[5].callback('json',{success=true})
events['jbl:play']('abcdefghijk')
local before=#notifications
decoded={stream_url='https://own.example/audio?ticket=old',duration_ms=180000}
obsolete.callback('json',{success=true})
assert(#notifications==before, 'old playback must not return after storing and reopening JBL')
requests[6].callback('json',{success=true})
assert(#notifications==before+1, 'current playback must still work')
JBLMusicConfig.apiKey=''
events['jbl:search']('sin configurar')
assert(#requests==6,'unconfigured backend must not receive requests')
print('PASS: MTA backend headers, API contract, errors, pause and resume')
