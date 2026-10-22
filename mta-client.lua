-- Run from resources with Lua or the bundled Fengari CLI.
local handlers, timers, created = {}, {}, {}
local ticks = 10000
root, resourceRoot = {}, {}
localPlayer = {dimension=0, interior=0, x=0}
local owner = {dimension=0, interior=0, x=0}
function addEvent() end
function addEventHandler(name, target, fn)
    handlers[name] = handlers[name] or {}
    handlers[name][target] = fn
end
function addCommandHandler() end
function bindKey() end
function setTimer(fn) timers[#timers+1]=fn end
function getTickCount() return ticks end
function isElement(e) return type(e)=='table' and not e.destroyed end
function destroyElement(e) e.destroyed=true end
function getElementPosition(e) return e.x or 0,0,0 end
function getElementDimension(e) return e.dimension end
function getElementInterior(e) return e.interior end
function getDistanceBetweenPoints3D(x,_,__,xx) return math.abs(x-xx) end
function playSound3D()
    local sound={}
    created[#created+1]=sound
    return sound
end
function setSoundMaxDistance() end
function setSoundMinDistance() end
function setSoundVolume() end
function setElementDimension(e,v) e.dimension=v end
function setElementInterior(e,v) e.interior=v end
function attachElements() return true end
function setSoundPaused(e,v) e.paused=v end
function setSoundPosition(e,v) e.position=v end
function outputChatBox() end
dofile('spotifySirilo/client.lua')
local function state(id, paused, elapsed)
    handlers['jbl:state'][resourceRoot](owner, {
        id=id, videoId='abcdefghijk', streamUrl='https://example.test/audio',
        durationMs=180000, elapsedMs=elapsed or 0, paused=paused or false, volume=80
    })
end
state(1)
ticks=ticks+5000
handlers.onClientSoundStream[created[1]](true)
assert(created[1].position==5, 'buffer time must count toward elapsed time')
owner.x=100
timers[1]()
assert(created[1].destroyed, 'leaving range destroys audio')
ticks=ticks+15000
owner.x=0
timers[1]()
handlers.onClientSoundStream[created[2]](true)
assert(created[2].position==20, 'returning listener must seek to current time')
state(2)
assert(created[2].destroyed and #created==3, 'same song with new state must restart')
handlers.onClientSoundStream[created[3]](false)
timers[1]()
timers[1]()
assert(#created==3, 'failed state must not retry every 500ms')
state(3, true, 7000)
ticks=ticks+10000
handlers.onClientSoundStream[created[4]](true)
assert(created[4].position==7 and created[4].paused, 'paused playback must not advance')
owner.dimension=1
timers[1]()
assert(created[4].destroyed, 'different dimensions must not share audio')
owner.dimension=0
timers[1]()
assert(#created==5, 'returning to dimension restores audio')
print('PASS: client buffering, range, replay, failure suppression, pause and dimensions')

