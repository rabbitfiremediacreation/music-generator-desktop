#import <Foundation/Foundation.h>

// Load the updater from the signed bundle. Local builds have no framework.
@interface NSObject (MusicGeneratorSparkle)
- (instancetype)initWithStartingUpdater:(BOOL)start updaterDelegate:(id)delegate userDriverDelegate:(id)driver;
- (id)updater;
- (BOOL)startUpdater:(NSError **)error;
- (void)setAutomaticallyChecksForUpdates:(BOOL)enabled;
- (BOOL)canCheckForUpdates;
- (void)checkForUpdates:(id)sender;
@end

static id controller;
static BOOL attempted;

static id updater(void) {
    if (!attempted) {
        attempted = YES;
        NSBundle *app = NSBundle.mainBundle;
        if (![app objectForInfoDictionaryKey:@"SUFeedURL"]) return nil;
        NSURL *url = [app.privateFrameworksURL URLByAppendingPathComponent:@"Sparkle.framework"];
        NSBundle *framework = [NSBundle bundleWithURL:url];
        NSError *error = nil;
        if (![framework loadAndReturnError:&error]) {
            NSLog(@"Could not load Sparkle: %@", error);
            return nil;
        }
        id candidate = [[NSClassFromString(@"SPUStandardUpdaterController") alloc]
            initWithStartingUpdater:NO updaterDelegate:nil userDriverDelegate:nil];
        if ([[candidate updater] startUpdater:&error]) {
            controller = candidate;
        } else {
            NSLog(@"Could not start Sparkle: %@", error);
        }
    }
    return [controller updater];
}

void music_configure_updates(BOOL enabled) {
    [updater() setAutomaticallyChecksForUpdates:enabled];
}

BOOL music_check_native_update(void) {
    id nativeUpdater = updater();
    if ([nativeUpdater canCheckForUpdates]) {
        [controller checkForUpdates:nil];
    }
    return nativeUpdater != nil;
}
