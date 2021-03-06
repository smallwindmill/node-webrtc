/* eslint no-cond-assign:0, no-console:0 */
'use strict';

const { RTCPeerConnection } = require('..');
const { getAnswer, onCandidate } = require('./loopback.common');

function onOpen(ws) {
  return new Promise((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onclose = () => reject(new Error('WebSocket closed'));
  });
}

async function main() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: true
  });

  console.log('Creating RTCPeerConnection');
  const pc = new RTCPeerConnection({
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require'
  });
  stream.getTracks().forEach(track => pc.addTrack(track, stream));

  function cleanup() {
    console.log('Stopping MediaStreamTracks');
    stream.getTracks().forEach(track => track.stop());
    console.log('Closing RTCPeerConnection');
    pc.close();
  }

  try {
    const ws = new WebSocket('ws://localhost:8080');
    await onOpen(ws);
    ws.onclose = cleanup;

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        console.log('Sending ICE candidate');
        ws.send(JSON.stringify({
          type: 'candidate',
          candidate
        }));
      }
    };

    let queuedCandidates = [];
    onCandidate(ws, async candidate => {
      if (!pc.remoteDescription) {
        queuedCandidates.push(candidate);
        return;
      }
      console.log('Adding ICE candidate');
      await pc.addIceCandidate(candidate);
      console.log('Added ICE candidate');
    });

    const video = document.createElement('video');
    document.body.appendChild(video);

    pc.ontrack = ({ track, streams }) => {
      console.log(`Received ${track.kind} MediaStreamTrack with ID ${track.id}`);
      video.srcObject = streams[0];
      video.autoplay = true;
    };

    console.log('Creating offer');
    const offer = await pc.createOffer();

    console.log('Created offer; setting local description');
    await pc.setLocalDescription(offer);

    console.log('Set local description; sending offer');
    ws.send(JSON.stringify(offer));

    console.log('Waiting for answer');
    const answer = await getAnswer(ws);

    console.log('Received answer; setting remote description');
    await pc.setRemoteDescription(answer);
    console.log('Set remote description');

    await Promise.all(queuedCandidates.splice(0).map(async candidate => {
      console.log('Adding ICE candidate');
      await pc.addIceCandidate(candidate);
      console.log('Added ICE candidate');
    }));
  } catch (error) {
    cleanup();
    throw error;
  }
}

main();
