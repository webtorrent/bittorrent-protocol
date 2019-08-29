
const Protocol = require('../')

describe('Extension',()=>{
    describe('Extension.prototype.name',()=>{
        it('No prototype name',()=>{
            const wire = new Protocol();
            function NoNameExtension () {}
            expect(()=>wire.use(NoNameExtension)).toThrow();
        });
        
        it('Has prototype name',()=>{
            const wire = new Protocol();
            function NamedExtension () {};
            NamedExtension.prototype.name='Foo';
            expect(()=>wire.use(NamedExtension)).not.toThrow();
        });
    })
    

    test('Extended Handshake',()=>{
        function TestExtension (wire) {
            wire.extendedHandshake = {
                hello: 'world!'
            }
        }
        TestExtension.prototype.name='test_extension';
        TestExtension.prototype.onExtendedHandshake = handshake =>{
            console.log(handshake);
            expect(handshake.m.test_extension).toBeTruthy();
            expect(handshake.hello.toString()).toEqual('world!');
        }
        const wire = new Protocol();
        wire.on('error',console.log);
        wire.pipe(wire);
        wire.once('handshake',(infoHash, peerId, extensions)=>{
            expect(extensions.extended).toBe(true);
        });
    
        wire.use(TestExtension);
    
        wire.handshake('3031323334353637383930313233343536373832','3132333435363738393031323334353637383930');
    })

    test('Handshake',()=>{
        function TestExtension() {}
        TestExtension.prototype.name='Test Extension';
        TestExtension.prototype.onHandshake = (infoHash, peerId, extensions)=>{
            expect(Buffer.from(infoHash, 'hex').length).toBe(20);
            expect(Buffer.from(infoHash, 'hex').toString()).toEqual('01234567890123456789');
            expect(Buffer.from(peerId, 'hex').length).toBe(20)
            expect(Buffer.from(peerId, 'hex').toString()).toEqual('12345678901234567890');    
        }
        const wire = new Protocol();
        wire.pipe(wire);
        wire.use(TestExtension);
        wire.handshake(Buffer.from('01234567890123456789'), Buffer.from('12345678901234567890'))
    })

    test('onMessage',()=>{
        class TestExtension {
            constructor(wire){
                this.wire = wire;
            }
            onMessage(message){
                expect(message.toString()).toEqual('hello world');
            }
        }
        TestExtension.prototype.name ='test_extension';
        const wire = new Protocol();
        wire.pipe(wire);
        wire.use(TestExtension);
        wire.handshake('3031323334353637383930313233343536373839', '3132333435363738393031323334353637383930');
        wire.once('extended',()=>{
            wire.extended('test_extension',Buffer.from('hello world'));
        })

        
    })

});

